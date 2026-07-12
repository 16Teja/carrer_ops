#!/usr/bin/env node
/**
 * auto-apply.mjs — AI-driven job application form filler
 *
 * Usage:
 *   node auto-apply.mjs <job-url> [--report=<path>] [--cv=<path>] [--no-upload] [--headless]
 *
 * Supports: Greenhouse, Ashby, Lever, LinkedIn, Workday + any portal (AI-driven)
 * For Workday/unknown portals: reads each page's visible fields, asks Claude what
 * to fill, executes fills, advances to next step. Stops before Submit.
 */

import { chromium } from 'playwright';
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import readline from 'readline';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let jobUrl = null;
let reportPath = null;
let cvPath = null;
let noUpload = false;
let headless = false;

for (const arg of args) {
  if (arg.startsWith('--report=')) reportPath = arg.slice(9);
  else if (arg.startsWith('--cv=')) cvPath = arg.slice(5);
  else if (arg === '--no-upload') noUpload = true;
  else if (arg === '--headless') headless = true;
  else if (!jobUrl && !arg.startsWith('--')) jobUrl = arg;
}

if (!jobUrl) {
  console.error('Usage: node auto-apply.mjs <job-url> [--report=<path>] [--cv=<path>] [--no-upload] [--headless]');
  process.exit(1);
}

// ── Portal detection ──────────────────────────────────────────────────────────
function detectPortal(url) {
  if (url.includes('greenhouse.io')) return 'greenhouse';
  if (url.includes('ashbyhq.com')) return 'ashby';
  if (url.includes('lever.co')) return 'lever';
  if (url.includes('linkedin.com')) return 'linkedin';
  if (url.includes('myworkdayjobs.com') || url.includes('workday.com')) return 'workday';
  return 'generic';
}

// ── Load profile ──────────────────────────────────────────────────────────────
async function loadProfile() {
  const p = resolve(__dirname, 'config/profile.yml');
  const content = await readFile(p, 'utf-8');
  return yaml.load(content);
}

// ── Find CV PDF ───────────────────────────────────────────────────────────────
async function findCV() {
  if (cvPath) {
    const p = resolve(cvPath);
    if (existsSync(p)) return p;
    console.warn(`  ⚠️  CV not found at ${p}`);
    return null;
  }
  const outputDir = resolve(__dirname, 'output');
  const files = await readdir(outputDir).catch(() => []);
  const pdfs = files.filter(f => f.toLowerCase().endsWith('.pdf')).sort().reverse();
  if (pdfs.length > 0) {
    const p = join(outputDir, pdfs[0]);
    console.log(`  CV:     ${pdfs[0]}`);
    return p;
  }
  console.warn('  ⚠️  No PDF in output/ — CV upload skipped.');
  return null;
}

// ── Find evaluation report ────────────────────────────────────────────────────
async function findReport(url) {
  if (reportPath) return readFile(resolve(reportPath), 'utf-8').catch(() => null);
  const reportsDir = resolve(__dirname, 'reports');
  const files = await readdir(reportsDir).catch(() => []);
  const mdFiles = files.filter(f => f.endsWith('.md')).sort().reverse();
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg.length < 3 || /^\d+$/.test(seg)) continue;
    const hit = mdFiles.find(f => f.toLowerCase().includes(seg.toLowerCase()));
    if (hit) return readFile(join(reportsDir, hit), 'utf-8').catch(() => null);
  }
  if (mdFiles.length > 0) return readFile(join(reportsDir, mdFiles[0]), 'utf-8').catch(() => null);
  return null;
}

// ── Build candidate profile string for AI ────────────────────────────────────
function profileSummary(profile) {
  const c = profile.candidate;
  const l = profile.location;
  const comp = profile.compensation;
  return `
Candidate profile:
- Full name: ${c.full_name}
- First name: ${c.full_name.split(' ')[0]}
- Last name: ${c.full_name.split(' ').slice(1).join(' ')}
- Email: ${c.email}
- Phone: ${c.phone}
- LinkedIn: https://${c.linkedin}
- GitHub: https://${c.github}
- City: ${l?.city || 'Chennai'}
- State: Tamil Nadu
- Country: India
- Zip/Postal: 600001
- Nationality: Indian
- Visa/work authorization: Indian citizen — legally authorized to work in India; requires sponsorship for international roles
- Requires visa sponsorship (international): Yes
- Current employer: Prodapt
- Current title: Software Engineer
- Years of experience: 1
- Education: B.Tech Computer Science, Vasavi College of Engineering, 2025
- Salary expectation: ${comp?.target_range || 'Open to discussion'}
- Notice period / start date: 30 days
- How did you hear about us: LinkedIn
- Willing to relocate: Yes
- Gender: Prefer not to say
- Ethnicity/diversity: Prefer not to disclose
- Veteran status: No
- Disability: Prefer not to disclose
`.trim();
}

// ── Extract visible form fields from the page ─────────────────────────────────
async function getPageFields(page) {
  return await page.evaluate(() => {
    const isVisible = el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && window.getComputedStyle(el).display !== 'none';
    };

    const getLabel = el => {
      // 1. <label for="id">
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl) return lbl.innerText.trim().split('\n')[0].trim();
      }
      // 2. aria-label / aria-labelledby
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
      if (el.getAttribute('aria-labelledby')) {
        const ref = document.getElementById(el.getAttribute('aria-labelledby'));
        if (ref) return ref.innerText.trim();
      }
      // 3. placeholder
      if (el.placeholder) return el.placeholder.trim();
      // 4. data-automation-id
      if (el.getAttribute('data-automation-id')) return el.getAttribute('data-automation-id').trim();
      // 5. name attribute
      if (el.name) return el.name.trim();
      // 6. Nearest parent label text
      const parent = el.closest('[class*="field"], [class*="Field"], [class*="form"], label');
      if (parent) {
        const clone = parent.cloneNode(true);
        clone.querySelectorAll('input,textarea,select,button').forEach(e => e.remove());
        return clone.innerText.trim().split('\n')[0].trim().slice(0, 80);
      }
      return '';
    };

    const fields = [];

    // Inputs
    document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"])').forEach(el => {
      if (!isVisible(el)) return;
      fields.push({
        label: getLabel(el),
        type: el.type || 'text',
        id: el.id || '',
        name: el.name || '',
        automationId: el.getAttribute('data-automation-id') || '',
        required: el.required,
        currentValue: el.value || '',
      });
    });

    // Textareas
    document.querySelectorAll('textarea').forEach(el => {
      if (!isVisible(el)) return;
      fields.push({ label: getLabel(el), type: 'textarea', id: el.id || '', name: el.name || '', automationId: el.getAttribute('data-automation-id') || '', required: el.required, currentValue: el.value || '' });
    });

    // Selects
    document.querySelectorAll('select').forEach(el => {
      if (!isVisible(el)) return;
      fields.push({
        label: getLabel(el),
        type: 'select',
        id: el.id || '',
        name: el.name || '',
        automationId: el.getAttribute('data-automation-id') || '',
        options: Array.from(el.options).map(o => o.text).filter(t => t.trim()),
        required: el.required,
        currentValue: el.value || '',
      });
    });

    // Workday custom dropdowns (not <select>)
    document.querySelectorAll('[data-automation-id$="input"], [data-automation-id*="dropdown"]').forEach(el => {
      if (!isVisible(el)) return;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return; // already captured
      fields.push({ label: getLabel(el), type: 'workday-dropdown', id: el.id || '', automationId: el.getAttribute('data-automation-id') || '', required: false });
    });

    // Visible buttons (Next / Continue / Submit)
    document.querySelectorAll('button, [role="button"]').forEach(el => {
      if (!isVisible(el)) return;
      const text = el.innerText?.trim();
      if (!text) return;
      if (/next|continue|save|submit|apply/i.test(text)) {
        fields.push({ label: text, type: 'button', id: el.id || '', automationId: el.getAttribute('data-automation-id') || '' });
      }
    });

    return fields;
  });
}

// ── Ask Claude what to fill ───────────────────────────────────────────────────
async function askAI(fields, profile, cvAvailable) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('  ⚠️  ANTHROPIC_API_KEY not set — falling back to rule-based filling');
    return null;
  }

  const client = new Anthropic({ apiKey });

  const prompt = `You are an AI assistant helping fill a job application form automatically.

${profileSummary(profile)}
CV/resume available for upload: ${cvAvailable ? 'Yes' : 'No'}

Current page has these visible form fields:
${JSON.stringify(fields, null, 2)}

Return a JSON array of fill instructions. Each instruction is one of:
- {"action":"fill", "id":"elementId", "name":"elementName", "automationId":"dataAutomationId", "label":"fieldLabel", "value":"valueToEnter"}
- {"action":"select", "id":"elementId", "name":"elementName", "automationId":"dataAutomationId", "label":"fieldLabel", "value":"optionTextToSelect"}
- {"action":"upload", "label":"file input label"}
- {"action":"click_yes", "label":"radio/checkbox label for yes/authorized/agree type questions"}
- {"action":"next"} — ONLY if there is a visible Next/Continue/Save button (NOT Submit)
- {"action":"stop"} — if you see a Submit/Apply Now button (user will click manually)

Rules:
- Skip fields already filled (currentValue not empty), UNLESS it's wrong
- For work authorization / legally authorized → Yes
- For visa sponsorship required → Yes
- For salary → use the candidate's expectation or "Open to discussion"
- For gender/race/veteran/disability → "Prefer not to say" or "Decline to self identify"
- Skip fields with no clear match in the candidate profile
- If you see ONLY a Submit button and no Next button → return [{"action":"stop"}]
- Return ONLY valid JSON array, no explanation, no markdown`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content[0].text.trim();
    // Strip markdown code fences if present
    const clean = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.warn(`  ⚠️  AI call failed: ${err.message}`);
    return null;
  }
}

// ── Execute AI fill instructions on the page ──────────────────────────────────
async function executeInstructions(page, instructions, cvFilePath) {
  const filled = [];
  let shouldAdvance = false;
  let shouldStop = false;

  for (const inst of instructions) {
    try {
      if (inst.action === 'stop') { shouldStop = true; break; }
      if (inst.action === 'next') { shouldAdvance = true; continue; }

      if (inst.action === 'upload') {
        if (!cvFilePath || noUpload) continue;
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(cvFilePath);
          filled.push('CV (PDF)');
          await page.waitForTimeout(1500);
        }
        continue;
      }

      if (inst.action === 'click_yes') {
        // Try various ways to find and click Yes/Authorized radio
        const selectors = [
          `label:has-text("Yes") input[type="radio"]`,
          `input[type="radio"][value="Yes"]`,
          `input[type="radio"][value="yes"]`,
          `[aria-label*="${inst.label}"]`,
        ];
        for (const sel of selectors) {
          const el = await page.$(sel).catch(() => null);
          if (el && await el.isVisible().catch(() => false)) {
            await el.click();
            filled.push(`${inst.label} → Yes`);
            break;
          }
        }
        continue;
      }

      // Build a list of locator strategies to try
      const strategies = [];
      if (inst.id) strategies.push(() => page.locator(`#${inst.id}`).first());
      if (inst.automationId) strategies.push(() => page.locator(`[data-automation-id="${inst.automationId}"]`).first());
      if (inst.name) strategies.push(() => page.locator(`[name="${inst.name}"]`).first());
      if (inst.label) {
        strategies.push(() => page.getByLabel(inst.label, { exact: false }).first());
        strategies.push(() => page.getByPlaceholder(inst.label, { exact: false }).first());
      }

      let el = null;
      for (const strategy of strategies) {
        try {
          const candidate = strategy();
          if (await candidate.isVisible({ timeout: 1000 })) {
            el = candidate;
            break;
          }
        } catch { /* try next */ }
      }

      if (!el) {
        console.log(`  ⚠️  Could not find: "${inst.label}"`);
        continue;
      }

      if (inst.action === 'fill') {
        await el.fill(String(inst.value));
        filled.push(`${inst.label}: "${String(inst.value).slice(0, 40)}"`);
      } else if (inst.action === 'select') {
        await el.selectOption({ label: inst.value }).catch(() =>
          el.selectOption({ value: inst.value }).catch(() =>
            el.selectOption(inst.value).catch(() => {})
          )
        );
        filled.push(`${inst.label}: "${inst.value}"`);
      }

      await page.waitForTimeout(200);
    } catch (err) {
      console.log(`  ⚠️  Error on "${inst.label}": ${err.message.split('\n')[0]}`);
    }
  }

  return { filled, shouldAdvance, shouldStop };
}

// ── Click the Next/Continue button ───────────────────────────────────────────
async function clickNext(page) {
  const selectors = [
    '[data-automation-id="bottom-navigation-next-btn"]',
    '[data-automation-id="nextButton"]',
    'button:has-text("Save and Continue")',
    'button:has-text("Continue")',
    'button:has-text("Next")',
    'button:has-text("Save")',
  ];
  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        const text = (await btn.textContent() || '').trim();
        if (/submit|apply now/i.test(text)) return false; // don't click submit
        await btn.click();
        console.log(`  → "${text}" clicked`);
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

// ── Click Apply button on job listing page ────────────────────────────────────
async function clickApplyButton(page) {
  await page.waitForTimeout(3000);
  const selectors = [
    '[data-automation-id="apply-button"]',
    '[data-automation-id="applyButton"]',
    'a[data-automation-id*="apply"]',
    'button:has-text("Apply Now")',
    'button:has-text("Apply")',
    'a:has-text("Apply Now")',
    'a:has-text("Apply")',
  ];
  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        const text = (await btn.textContent() || '').trim();
        await btn.click();
        console.log(`  ✓ Clicked: "${text}"`);
        return true;
      }
    } catch { /* try next */ }
  }
  console.log('  ⚠️  Apply button not found — may already be on the form');
  return false;
}

// ── AI-driven filler (Workday + generic) ─────────────────────────────────────
async function fillWithAI(page, profile, cvFilePath, reportText, portalName) {
  const allFilled = [];
  const allSkipped = [];

  // Step 1: Click Apply button
  console.log('\n  → Clicking Apply button...');
  await clickApplyButton(page);
  await page.waitForTimeout(4000);

  // Step 2: Handle login/account wall
  const needsLogin = await page.$('input[type="password"], [data-automation-id="email"], [data-automation-id="signIn"]').catch(() => null);
  if (needsLogin) {
    console.log('\n  ⚠️  Login / account creation screen detected.');
    console.log('     Sign in or create a Workday account in the browser.');
    await waitForEnter('     Press ENTER here once you are on the application form: ');
    await page.waitForTimeout(3000);
  }

  // Step 3: Upload CV first if file input visible
  if (cvFilePath && !noUpload) {
    const fileInput = await page.$('input[type="file"]').catch(() => null);
    if (fileInput) {
      await fileInput.setInputFiles(cvFilePath);
      console.log('  ✓ CV uploaded');
      allFilled.push('CV (PDF)');
      await page.waitForTimeout(2000);
    }
  }

  // Step 4: AI-driven multi-step filling
  let stepNum = 0;
  const maxSteps = 12;

  while (stepNum < maxSteps) {
    stepNum++;
    await page.waitForTimeout(2500);

    const currentUrl = page.url();
    console.log(`\n  📋 Step ${stepNum} — ${currentUrl.split('/').pop().split('?')[0]}`);

    // Check if Submit button is visible — we're done
    const submitVisible = await page.$('button:has-text("Submit"), [data-automation-id*="submit"]').catch(() => null);
    if (submitVisible) {
      const submitText = await submitVisible.textContent().catch(() => '');
      if (/submit/i.test(submitText)) {
        console.log('\n  🛑 Submit button is visible — stopping. YOU click Submit.');
        break;
      }
    }

    // Extract visible fields
    const fields = await getPageFields(page);
    const interactiveFields = fields.filter(f => f.type !== 'button');
    const buttons = fields.filter(f => f.type === 'button');

    if (interactiveFields.length === 0 && buttons.length === 0) {
      console.log('     No fields found on this step — advancing...');
      const advanced = await clickNext(page);
      if (!advanced) break;
      continue;
    }

    console.log(`     Found ${interactiveFields.length} field(s): ${interactiveFields.slice(0, 5).map(f => f.label || f.type).join(', ')}${interactiveFields.length > 5 ? '...' : ''}`);

    // Ask AI
    const instructions = await askAI(fields, profile, !!(cvFilePath && !noUpload));

    if (!instructions) {
      // AI unavailable — rule-based fallback
      console.log('     Using rule-based fallback...');
      const stepFilled = await ruleBasedFill(page, profile, cvFilePath);
      allFilled.push(...stepFilled);
      await clickNext(page);
      continue;
    }

    // Execute AI instructions
    const { filled, shouldAdvance, shouldStop } = await executeInstructions(page, instructions, cvFilePath);
    allFilled.push(...filled);

    if (filled.length > 0) console.log(`     Filled: ${filled.join(' | ')}`);
    if (shouldStop) { console.log('\n  🛑 AI detected Submit page — stopping. YOU click Submit.'); break; }

    if (shouldAdvance) {
      await page.waitForTimeout(500);
      const advanced = await clickNext(page);
      if (!advanced) {
        // Maybe AI said next but no button found — check submit
        const sub = await page.$('button:has-text("Submit")').catch(() => null);
        if (sub) { console.log('\n  🛑 Reached Submit — stopping. YOU click Submit.'); break; }
        break;
      }
    } else {
      // AI gave no next instruction — check manually
      const advanced = await clickNext(page);
      if (!advanced) break;
    }
  }

  return { filled: allFilled, skipped: allSkipped };
}

// ── Rule-based fallback (no API key) ─────────────────────────────────────────
async function ruleBasedFill(page, profile, cvFilePath) {
  const { candidate, location } = profile;
  const filled = [];

  const fieldMap = [
    ['input[autocomplete*="given-name"], input[name*="first" i]', candidate.full_name.split(' ')[0], 'First name'],
    ['input[autocomplete*="family-name"], input[name*="last" i]', candidate.full_name.split(' ').slice(1).join(' '), 'Last name'],
    ['input[type="email"], input[name*="email" i]', candidate.email, 'Email'],
    ['input[type="tel"], input[name*="phone" i]', candidate.phone, 'Phone'],
    ['input[name*="linkedin" i], input[placeholder*="linkedin" i]', `https://${candidate.linkedin}`, 'LinkedIn'],
    ['input[name*="github" i], input[placeholder*="github" i]', `https://${candidate.github}`, 'GitHub'],
    ['input[name*="city" i], input[placeholder*="city" i]', location?.city || 'Chennai', 'City'],
  ];

  for (const [sel, val, label] of fieldMap) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) { await el.fill(String(val)); filled.push(label); }
    } catch { /* skip */ }
  }

  if (cvFilePath && !noUpload) {
    const fi = await page.$('input[type="file"]').catch(() => null);
    if (fi) { await fi.setInputFiles(cvFilePath).catch(() => {}); filled.push('CV'); }
  }

  return filled;
}

// ── Answer generator for static portals ──────────────────────────────────────
function generateAnswer(questionText, profile) {
  const q = questionText.toLowerCase();
  const { candidate, narrative, location, compensation } = profile;
  if (/require.*visa.*sponsor|need.*visa.*sponsor/i.test(q)) return 'Yes';
  if (/legally authorized|authorized to work|right to work/i.test(q)) return 'Yes';
  if (/salary.*expect|desired.*comp|ctc|lpa/i.test(q)) return compensation?.target_range || 'Open to discussion';
  if (/years.*experience|experience.*years/i.test(q)) return '1';
  if (/relocat/i.test(q)) return 'Yes';
  if (/how did you (hear|find)/i.test(q)) return 'LinkedIn';
  if (/why.*compan|why.*role|cover letter|about yourself/i.test(q)) return `${narrative?.headline || ''}. ${narrative?.exit_story || ''}`.trim();
  if (/linkedin/i.test(q) && /url|link/i.test(q)) return `https://${candidate?.linkedin}`;
  if (/github|portfolio/i.test(q)) return `https://${candidate?.github}`;
  if (/start date|notice|available/i.test(q)) return '30 days';
  if (/gender|pronoun/i.test(q)) return 'Prefer not to say';
  if (/ethnicity|race|veteran|disability/i.test(q)) return 'Prefer not to disclose';
  return null;
}

// ── Static Greenhouse filler ──────────────────────────────────────────────────
async function fillGreenhouse(page, profile, cvFilePath) {
  const { candidate } = profile;
  const filled = [], skipped = [];
  await page.waitForSelector('form', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const firstName = candidate.full_name.split(' ')[0];
  const lastName = candidate.full_name.split(' ').slice(1).join(' ');
  const tries = async (sel, val, label) => { try { const el = await page.$(sel); if (el && await el.isVisible()) { await el.fill(String(val)); filled.push(label); return true; } } catch {} return false; };
  await tries('#first_name', firstName, 'First name');
  await tries('#last_name', lastName, 'Last name');
  await tries('#email', candidate.email, 'Email');
  await tries('#phone', candidate.phone, 'Phone');
  await tries('#job_application_location', `${profile.location?.city}, ${profile.location?.country}`, 'Location');
  await tries('input[name="job_application[linkedin_url]"]', `https://${candidate.linkedin}`, 'LinkedIn');
  await tries('input[name="job_application[website]"]', `https://${candidate.github}`, 'Website');
  if (cvFilePath && !noUpload) {
    try { const fi = await page.$('#resume, input[name="resume"]'); if (fi) { await fi.setInputFiles(cvFilePath); filled.push('CV (PDF)'); } } catch {}
  }
  const customQs = await page.$$('li.custom-question').catch(() => []);
  for (const qEl of customQs) {
    const label = await qEl.$eval('label', el => el.textContent?.trim()).catch(() => '');
    const inputEl = await qEl.$('input[type="text"], textarea').catch(() => null);
    if (inputEl && label) {
      const answer = generateAnswer(label, profile);
      if (answer) { await inputEl.fill(answer); filled.push(`Q: "${label.slice(0, 40)}"`); }
      else skipped.push(label);
    }
  }
  return { filled, skipped };
}

// ── Static Ashby filler ───────────────────────────────────────────────────────
async function fillAshby(page, profile, cvFilePath) {
  const { candidate } = profile;
  const filled = [], skipped = [];
  await page.waitForSelector('form, [data-testid]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const tryLabel = async (pattern, value, label) => {
    for (const sel of [`input[aria-label*="${pattern}" i]`, `input[placeholder*="${pattern}" i]`, `input[name*="${pattern}" i]`]) {
      try { const el = await page.$(sel); if (el && await el.isVisible()) { await el.fill(String(value)); filled.push(label); return true; } } catch {}
    }
    return false;
  };
  const firstFilled = await tryLabel('first', candidate.full_name.split(' ')[0], 'First name');
  const lastFilled = await tryLabel('last', candidate.full_name.split(' ').slice(1).join(' '), 'Last name');
  if (!firstFilled && !lastFilled) await tryLabel('name', candidate.full_name, 'Full name');
  await tryLabel('email', candidate.email, 'Email');
  await tryLabel('phone', candidate.phone, 'Phone');
  await tryLabel('linkedin', `https://${candidate.linkedin}`, 'LinkedIn');
  await tryLabel('location', `${profile.location?.city}, ${profile.location?.country}`, 'Location');
  const textareas = await page.$$('textarea').catch(() => []);
  for (const ta of textareas) {
    const label = await ta.getAttribute('aria-label').catch(() => '') || await ta.getAttribute('placeholder').catch(() => '') || '';
    const answer = generateAnswer(label, profile);
    if (answer && label) { await ta.fill(answer); filled.push(`Q: "${label.slice(0, 40)}"`); }
  }
  if (cvFilePath && !noUpload) {
    const fileInputs = await page.$$('input[type="file"]').catch(() => []);
    for (const fi of fileInputs) { await fi.setInputFiles(cvFilePath).catch(() => {}); filled.push('CV (PDF)'); break; }
  }
  return { filled, skipped };
}

// ── Static Lever filler ───────────────────────────────────────────────────────
async function fillLever(page, profile, cvFilePath) {
  const { candidate } = profile;
  const filled = [], skipped = [];
  await page.waitForSelector('.application-form, form', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const tries = async (sel, val, label) => { try { const el = await page.$(sel); if (el && await el.isVisible()) { await el.fill(String(val)); filled.push(label); return true; } } catch {} return false; };
  await tries('input[name="name"]', candidate.full_name, 'Full name');
  await tries('input[name="email"]', candidate.email, 'Email');
  await tries('input[name="phone"]', candidate.phone, 'Phone');
  await tries('input[name="urls[LinkedIn]"]', `https://${candidate.linkedin}`, 'LinkedIn');
  await tries('input[name="urls[GitHub]"]', `https://${candidate.github}`, 'GitHub');
  if (cvFilePath && !noUpload) {
    try { const fi = await page.$('input[type="file"]'); if (fi) { await fi.setInputFiles(cvFilePath); filled.push('CV (PDF)'); } } catch {}
  }
  const textareas = await page.$$('textarea').catch(() => []);
  for (const ta of textareas) {
    const name = await ta.getAttribute('name').catch(() => '');
    const label = name ? await page.$eval(`label[for="${name}"]`, el => el.textContent?.trim()).catch(() => name) : '';
    const answer = generateAnswer(label, profile);
    if (answer && label) { await ta.fill(answer); filled.push(`Q: "${label.slice(0, 40)}"`); }
    else if (label) skipped.push(label);
  }
  return { filled, skipped };
}

// ── Update tracker ────────────────────────────────────────────────────────────
async function updateTrackerStatus(url) {
  try {
    const trackerPath = resolve(__dirname, 'data/applications.md');
    const content = await readFile(trackerPath, 'utf-8');
    const urlSegments = new URL(url).pathname.split('/').filter(Boolean);
    const companySlug = urlSegments.find(s => s.length > 3 && !/^\d+$/.test(s)) || '';
    const lines = content.split('\n');
    let updated = false;
    const newLines = lines.map(line => {
      if (!line.startsWith('|') || !line.includes('| Evaluated |')) return line;
      if (companySlug && !line.toLowerCase().includes(companySlug.toLowerCase())) return line;
      updated = true;
      return line.replace('| Evaluated |', '| Applied |');
    });
    if (updated) {
      const { writeFile } = await import('fs/promises');
      await writeFile(trackerPath, newLines.join('\n'));
      console.log('  ✓ Tracker updated: Evaluated → Applied');
    } else {
      console.log('  ℹ️  No matching "Evaluated" row found — update applications.md manually.');
    }
  } catch (err) {
    console.warn(`  ⚠️  Tracker update failed: ${err.message}`);
  }
}

// ── Wait for Enter ────────────────────────────────────────────────────────────
function waitForEnter(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const portal = detectPortal(jobUrl);
  console.log('\n🚀 auto-apply — AI-driven Form Filler');
  console.log('─'.repeat(50));
  console.log(`  URL:    ${jobUrl}`);
  console.log(`  Portal: ${portal}`);

  const [profile, cvFilePath, reportText] = await Promise.all([
    loadProfile(),
    findCV(),
    findReport(jobUrl),
  ]);

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  console.log(`  AI:     ${hasApiKey ? 'Claude (dynamic filling)' : 'Rule-based fallback (set ANTHROPIC_API_KEY for AI)'}`);
  console.log(`  CV:     ${cvFilePath || '(none)'}`);
  console.log('─'.repeat(50));

  const browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : 30,
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  console.log('\n🌐 Opening browser...');
  await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  let result = { filled: [], skipped: [] };

  try {
    switch (portal) {
      case 'greenhouse': result = await fillGreenhouse(page, profile, cvFilePath); break;
      case 'ashby':     result = await fillAshby(page, profile, cvFilePath); break;
      case 'lever':     result = await fillLever(page, profile, cvFilePath); break;
      case 'workday':
      case 'linkedin':
      case 'generic':
      default:
        result = await fillWithAI(page, profile, cvFilePath, reportText, portal);
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
  }

  // Summary
  console.log('\n' + '─'.repeat(50));
  console.log(`✅ Done — ${result.filled.length} field(s) filled\n`);
  result.filled.forEach(f => console.log(`  ✓ ${f}`));
  if (result.skipped?.length) {
    console.log(`\n  ⚠️  ${result.skipped.length} unanswered question(s):`);
    result.skipped.forEach(q => console.log(`     ! ${q}`));
  }

  console.log('\n' + '─'.repeat(50));
  console.log('👆 Review the form in the browser, then click Submit.\n');

  const ans = await waitForEnter('   Press ENTER after submitting (or type skip): ');
  if (String(ans).toLowerCase() !== 'skip') {
    console.log('\n📊 Updating tracker...');
    await updateTrackerStatus(jobUrl);
  }

  await browser.close();
  console.log('\n✅ Done.\n');
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  process.exit(1);
});
