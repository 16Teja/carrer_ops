# Mode: auto-apply — Automated Form Filler

Launches a Playwright browser, navigates to the job application URL, and fills the entire form automatically from your profile and evaluation report. Stops before Submit — you click the button.

## Supported portals

| Portal | Coverage |
|--------|----------|
| Greenhouse | Full — all standard fields + custom questions |
| Ashby | Full — aria-label and placeholder detection |
| Lever | Full — standard fields + textareas + dropdowns |
| LinkedIn Easy Apply | Partial — first step fields; remaining steps in browser |
| Generic / Other | Best-effort — common field name patterns |

## When to use

- You're ready to apply to a role that's been evaluated (score ≥ 3.5)
- You want the form filled in one command rather than manually
- Works best after generating a tailored CV PDF from the `pdf` or `latex` mode

## Usage

```bash
node auto-apply.mjs <job-url>

# Specify a CV PDF explicitly (otherwise picks the latest PDF from output/)
node auto-apply.mjs <job-url> --cv=output/my-cv.pdf

# Point at a specific evaluation report for richer answer context
node auto-apply.mjs <job-url> --report=reports/006-acme-ai-engineer-2026-05-20.md

# Skip CV upload (if you haven't compiled yet)
node auto-apply.mjs <job-url> --no-upload

# Run in headless mode (no visible browser window)
node auto-apply.mjs <job-url> --headless
```

Or via npm:
```bash
npm run auto-apply -- <job-url>
```

## What gets filled automatically

**Standard fields (from config/profile.yml):**
- First / Last name
- Email, Phone
- LinkedIn URL, GitHub / Website URL
- Location / City
- Current company

**CV upload:**
- Uploads the most recent PDF from `output/` (or `--cv` path)

**Screening questions (auto-generated from profile + report):**
- Work authorization / visa sponsorship
- Salary expectations
- Years of experience
- Relocation willingness
- How did you hear about us
- Why this company / role
- Cover letter / About yourself
- Start date / notice period
- EEO / diversity fields

## What you do manually

1. Review the filled form in the browser for accuracy
2. Fill any fields flagged as "needs your input" in the terminal
3. Click **Submit**
4. Press ENTER in the terminal — tracker updates automatically (Evaluated → Applied)

## Workflow in practice

```
/career-ops         → paste job URL → evaluate (A-F score)
/career-ops latex   → generate tailored .tex → compile PDF locally
node auto-apply.mjs <url> --cv=output/your-cv.pdf
                    → form filled → you review → you submit
                    → tracker auto-updated to Applied
```

## Notes

- The browser opens in visible mode by default so you can review in real time
- If a field can't be detected, it's listed in the terminal as "needs your input"
- For Ashby/Lever multi-page forms, run the command once per visible screen
- LinkedIn Easy Apply is multi-step — continue each step manually after the first screen is filled
