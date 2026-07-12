# Story Bank — Master STAR+R Stories

This file accumulates your best interview stories over time. Each evaluation (Block F) adds new stories here. Instead of memorizing 100 answers, maintain 5-10 deep stories that you can bend to answer almost any behavioral question.

## How it works

1. Every time `/career-ops oferta` generates Block F (Interview Plan), new STAR+R stories get appended here
2. Before your next interview, review this file — your stories are already organized by theme
3. The "Big Three" questions can be answered with stories from this bank:
   - "Tell me about yourself" → combine 2-3 stories into a narrative
   - "Tell me about your most impactful project" → pick your highest-impact story
   - "Tell me about a conflict you resolved" → find a story with a Reflection

## Stories

---

### [Ownership] LLM Context Generation Pipeline
**Source:** Report #003 — Amazon — SDE-I University TA
**S (Situation):** Prodapt's LLM systems were producing hallucinations in production because the context fed into the model was unstructured and noisy.
**T (Task):** Design and ship an end-to-end pipeline that parses CPP codebases and generates structured semantic context for LLM consumption.
**A (Action):** Used Libclang to parse codebases, built a structured context extraction layer, integrated it into the LLM inference pipeline end-to-end.
**R (Result):** 30% reduction in hallucination cases in production.
**Reflection:** Would add automated evaluation metrics (hallucination rate tracking) from day one instead of relying on manual observation post-deployment.
**Best for questions about:** Ownership, technical depth, production systems, solving ambiguous problems

---

### [Customer Obsession] LLM Helpdesk Automation
**Source:** Report #003 — Amazon — SDE-I University TA
**S (Situation):** Internal helpdesk had slow ticket resolution affecting employee productivity daily — categorization was manual and responses were generic.
**T (Task):** Build an LLM-powered system to automate issue categorization and ticket handling with relevant, contextual responses.
**A (Action):** Fine-tuned an LLM for helpdesk categorization, implemented RAG for dynamic knowledge retrieval from internal docs, built sanitization pipelines.
**R (Result):** 35% reduction in ticket resolution time, 40% improvement in contextual response quality.
**Reflection:** Would instrument user satisfaction scores alongside time metrics — speed alone doesn't capture whether the answers were actually useful.
**Best for questions about:** Customer obsession, impact, data-driven decision making, AI in production

---

### [Bias for Action] MCP Integration — Master AI Agent
**Source:** Report #003 — Amazon — SDE-I University TA
**S (Situation):** Dialogflow-based trigger intents were unreliable and hard to maintain — every new tool required custom intent engineering.
**T (Task):** Replace Dialogflow with MCP-based tool execution within a sprint timeline.
**A (Action):** Refactored the integration layer, built MCP protocol handlers, enabled the Master AI Agent to call internal tools directly without intent mapping.
**R (Result):** Fully replaced Dialogflow — improved reliability and expanded automation coverage without added complexity.
**Reflection:** Would prototype MCP in a standalone spike before committing to full refactor — the refactor uncovered edge cases that a spike would have surfaced faster.
**Best for questions about:** Bias for action, simplification, technical decisions, speed

---

### [Learn and Be Curious] DDoS Detection (CNN + Transformer)
**Source:** Report #003 — Amazon — SDE-I University TA
**S (Situation):** Needed to build a real-time DDoS detection system with no prior experience in CNN + Transformer hybrid architectures.
**T (Task):** Deliver a working, accurate detection framework in under 2 months.
**A (Action):** Self-taught the hybrid deep learning approach, iterated on CNN feature extraction and Transformer sequence modeling, tuned thresholds against real traffic patterns.
**R (Result):** 95% classification accuracy.
**Reflection:** Would study production deployment constraints (latency, model size) earlier in the project — accuracy was strong but deployment optimization came late.
**Best for questions about:** Learning agility, technical curiosity, working with ambiguity, CS fundamentals

---

### [Deliver Results] Canniecare — ML Disease Detection
**Source:** Report #003 — Amazon — SDE-I University TA
**S (Situation):** No accessible tool existed for detecting diseases in stray dogs — diagnosis was slow, manual, and required expert vets.
**T (Task):** Build an end-to-end ML system from data collection through deployment that non-experts could use.
**A (Action):** Built a PyTorch model, iterated on training data, wrapped it in a Flask app for usability, deployed end-to-end.
**R (Result):** 92% model accuracy, 40% faster diagnosis compared to manual expert review.
**Reflection:** Would have done structured error analysis on the confusion matrix earlier — found key misclassifications late and fixing them cost extra weeks.
**Best for questions about:** Delivering results, end-to-end ownership, real-world impact, ML engineering

---

### [Invent and Simplify] AI Meeting Scheduler Agent
**Source:** Report #003 — Amazon — SDE-I University TA
**S (Situation):** Meeting scheduling across tools (Gmail, Google Calendar, transcript services) was fragmented and fully manual.
**T (Task):** Build an agentic system to automate the full meeting lifecycle.
**A (Action):** Integrated MCP to orchestrate Gmail, Calendar APIs, MoM services, and transcript generation into one agent with single-command workflows.
**R (Result):** Full meeting lifecycle automated — creation, updates, reminders, and transcript generation without manual steps.
**Reflection:** Would design the MCP interface contract before building the integrations — mid-build interface changes caused rework on 2 of the 4 integrations.
**Best for questions about:** Inventing and simplifying, agentic AI, end-to-end thinking, automation
