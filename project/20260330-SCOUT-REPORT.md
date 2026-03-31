# Legal Agent Flow Demo Project -- Scout Report

**Scouted:** 2026-03-30
**Project:** A demo legal matter progression agent -- a Next.js app where users pick a legal matter type (e.g., residential conveyancing) and an AI agent suggests next steps in the matter lifecycle. Built to demonstrate alignment with the product and stack.
**Tech Stack:** Next.js, React, TypeScript, Drizzle ORM, Neon PostgreSQL, Vercel AI SDK, Langfuse, deployed on Vercel
**Deployment:** Vercel Hobby (free) tier
**Constraint:** Must use free LLM APIs (no paid keys)

---

## 1. Free LLM APIs

### [Google Gemini](https://ai.google.dev/) (via [Google AI Studio](https://aistudio.google.com/)) -- PRIMARY RECOMMENDATION

**What:** Google's Gemini API has the most generous free tier of any major LLM provider. Access via a free API key from [Google AI Studio](https://aistudio.google.com/).

**Free Tier Models (March 2026):**

| Model | RPM | Requests/Day | Tokens/Min | Context | Notes |
|---|---|---|---|---|---|
| Gemini 2.5 Flash | 10 | 250 | 250,000 | 1M | Best quality-to-rate-limit ratio; **shutdown June 17, 2026** |
| Gemini 2.5 Flash-Lite | 15 | 1,000 | 250,000 | 1M | Highest daily quota; lightweight |
| Gemini 3 Flash (preview) | ~5 | ~100 | TBD | TBD | Newest; better reasoning benchmarks; preview status |
| Gemini 3.1 Flash-Lite (preview) | TBD | TBD | TBD | TBD | Preview; not yet stable |

**Feasibility:** Straightforward. The [`@ai-sdk/google`](https://www.npmjs.com/package/@ai-sdk/google) package (v3.0.53, ~1.1MB unpacked) provides first-class Gemini support in Vercel AI SDK. Setup is `google('gemini-2.5-flash')` with the `GOOGLE_GENERATIVE_AI_API_KEY` env var.

**Cost Estimate:**

| Metric | Value | Notes |
|---|---|---|
| Monetary | $0 | Entirely free |
| Rate limit headroom | 250 req/day with 2.5 Flash | Sufficient for demo/interview use |
| Quality | HIGH | 2.5 Flash scores 82.8% on GPQA Diamond; strong reasoning and tool calling |

**Recommendation:** Use **Gemini 2.5 Flash** as primary. It has the best balance of quality, rate limits, and stability. Gemini 3 Flash is stronger on benchmarks but is still in preview -- use it as a stretch goal. Note the June 2026 shutdown date for 2.5 Flash; for a demo project built now, this is not a blocker.

**Ecosystem:** Dec 2025 saw a 50-80% rate limit reduction across all free models. Despite this, Gemini's free tier remains the most generous in the industry.

### [Groq](https://console.groq.com/) -- SECONDARY / FALLBACK

**What:** Ultra-fast inference on open-source models. Free tier, no credit card.

**Free Tier Limits:**

| Model | RPM | Requests/Day | Tokens/Min (output) | Tokens/Day (output) |
|---|---|---|---|---|
| llama-3.3-70b-versatile | 30 | 1,000 | 12,000 | 100,000 |
| meta-llama/llama-4-scout-17b | 30 | 1,000 | 30,000 | 500,000 |
| llama-3.1-8b-instant | 30 | 14,400 | 6,000 | 500,000 |

**Feasibility:** Straightforward. Vercel AI SDK has [`@ai-sdk/groq`](https://www.npmjs.com/package/@ai-sdk/groq) provider. Groq is OpenAI-API-compatible.

**Cost Estimate:** $0 monetary. Token limits are tighter than Gemini (100K output tokens/day for the best model vs Gemini's 250K TPM). Quality of Llama 3.3 70B is good but below Gemini 2.5 Flash for structured reasoning.

**Use Case:** Good fallback if Gemini rate limits are hit during live demo. Could also show provider-agnostic architecture by swapping providers in one line.

### [OpenRouter](https://openrouter.ai/) -- TERTIARY

**What:** Aggregator offering ~29 free models. 20 RPM, 200 requests/day limits.

**Key Free Models:** Llama 3.3 70B, GPT-OSS 120B, Qwen3 Coder 480B, Nemotron 3 Super (262K context).

**Feasibility:** Moderate. No official `@ai-sdk/openrouter` package, but OpenRouter is OpenAI-compatible, so you can use `@ai-sdk/openai` with a custom base URL. The free models rotate -- some may disappear.

**Use Case:** Not recommended as primary. Model instability (models leave free tier without notice) makes it unreliable for a demo. Useful for showing awareness of the ecosystem.

### Verdict

Use **Gemini 2.5 Flash** via [`@ai-sdk/google`](https://www.npmjs.com/package/@ai-sdk/google). It is the strongest free model, has first-class Vercel AI SDK support, sufficient rate limits for a demo, and aligns with the kind of provider the company would actually evaluate.

---

## 2. [Vercel AI SDK](https://ai-sdk.dev/)

### Current State (v6.0.141)

**What:** The AI Toolkit for TypeScript by [Vercel](https://vercel.com/). Open-source, provider-agnostic, purpose-built for [Next.js](https://nextjs.org/) and [React](https://react.dev/).

| Attribute | Detail |
|---|---|
| Version | 6.0.141 (published 2026-03-28 -- 2 days ago) |
| Package size | ~6.5MB unpacked (tree-shakes heavily) |
| License | Apache-2.0 |
| Maintenance | Extremely active -- multiple releases per week |

**Key Features for This Demo:**

1. **Agent Abstraction (v6):** Define an agent with model, instructions, and tools. Reuse across chat UIs, API routes, background jobs. This is the headline feature of v6.
2. **Tool Calling with `stopWhen`:** The agent loop continues calling tools until a condition is met. Built-in multi-step reasoning without manual loop management.
3. **`generateText` / `streamText`:** Core functions. `streamText` is critical for UX -- shows the agent "thinking" in real-time.
4. **Structured Output:** `generateObject` with [Zod](https://zod.dev/) schemas for type-safe LLM responses. Combine with tool calling in v6.
5. **Provider Abstraction:** Swap `google('gemini-2.5-flash')` for `openai('gpt-4o')` in one line. Demonstrates architectural maturity.
6. **AI Gateway:** v6 can route through Vercel's AI Gateway for unified access to 100+ models. Optional but impressive for demo.

**Feasibility:** Straightforward. This is the natural choice for a Next.js app targeting Vercel. the company's stack is Next.js on Vercel -- using AI SDK shows direct alignment.

**Cost Estimate:**

| Metric | Delta | Notes |
|---|---|---|
| Bundle impact | ~50-100KB gzipped (tree-shaken) | Only imports used functions |
| Dependencies | `ai` + `@ai-sdk/google` (2 packages) | Minimal dependency tree |
| Complexity | 2/5 | Well-documented, purpose-built for Next.js |

**Ecosystem:** v6 was a major release in early 2026. The Agent abstraction, AI Gateway, and DevTools represent a significant maturation. Community adoption is very high (the `ai` npm package is among the most downloaded AI packages).

**Blockers:** None. This is the clear choice.

---

## 3. AI Agent Frameworks Comparison

the company's job description explicitly says they are "evaluating AI agent frameworks." Demonstrating knowledge of the landscape is high-value.

### [Vercel AI SDK](https://ai-sdk.dev/) (v6) -- RECOMMENDED FOR THIS DEMO

| Attribute | Detail |
|---|---|
| Package | [`ai`](https://www.npmjs.com/package/ai) (6.5MB unpacked) |
| Agent pattern | Built-in Agent abstraction, tool loops, structured output |
| Streaming | First-class React hooks (`useChat`, `useCompletion`), SSE |
| Provider support | 25+ via official packages, 100+ via AI Gateway |
| Learning curve | Low for Next.js developers |
| Best for | Web apps with AI features; Next.js/React |

### [LangChain.js](https://js.langchain.com/) + [LangGraph.js](https://langchain-ai.github.io/langgraphjs/)

| Attribute | Detail |
|---|---|
| Packages | [`langchain`](https://www.npmjs.com/package/langchain) (2.8MB) + [`@langchain/langgraph`](https://www.npmjs.com/package/@langchain/langgraph) (3.0MB) |
| Agent pattern | Graph-based state machines; nodes and edges; branching, looping, human-in-the-loop |
| Streaming | Async iterators; manual React integration |
| Provider support | 50+ integrations |
| Learning curve | Steep; complex abstraction layers; "sometimes overly complex" for simple use cases |
| Best for | Complex multi-agent workflows; stateful orchestration; enterprise |

### [Mastra](https://mastra.ai/)

| Attribute | Detail |
|---|---|
| Package | [`mastra`](https://www.npmjs.com/package/mastra) (18.8MB unpacked -- large) |
| Agent pattern | Agent class with LLM + tools; 40+ provider connectors |
| Background | Created by Gatsby team; YC W25; $13M seed; 22K+ GitHub stars |
| Streaming | Built-in |
| Learning curve | Moderate; newer ecosystem; less documentation |
| Best for | TypeScript-native agent apps; teams wanting opinionated structure |

### Analysis for the company's Context

the company is "evaluating AI agent frameworks" for a product going from PoC to production. The relevant trade-offs:

- **Vercel AI SDK** fits their stack (Next.js, Vercel) perfectly. Lowest friction. Best for products where the AI is a feature within a web app, not the entire architecture.
- **LangGraph.js** is the strongest for complex, stateful agent workflows with branching logic -- which is exactly what legal matter progression is. If the company needs agents that manage multi-step legal workflows with conditional paths, human approvals, and persistent state, LangGraph is the most capable framework.
- **Mastra** is the newest contender, TypeScript-native, gaining traction fast. Worth mentioning as an option the company might evaluate.

**Recommendation for demo:** Use Vercel AI SDK. It matches the company's stack, has the lowest friction, and v6's Agent abstraction is sufficient for a demo. Mention LangGraph.js as an option for more complex production workflows -- this shows architectural thinking beyond the demo.

The Vercel AI SDK also has a [LangChain adapter](https://ai-sdk.dev/providers/adapters/langchain) ([`@ai-sdk/langchain`](https://www.npmjs.com/package/@ai-sdk/langchain)), so it is not an either/or choice in production -- you can use LangChain for orchestration and AI SDK for the UI layer.

---

## 4. [Langfuse](https://langfuse.com/) Observability

### Current State

**What:** Open-source LLM observability platform. Tracing, prompt management, evaluations, cost tracking, sessions.

| Attribute | Detail |
|---|---|
| [Cloud free tier](https://langfuse.com/pricing) | 50,000 units/month, 30-day retention, 2 users |
| Package ([`langfuse`](https://www.npmjs.com/package/langfuse)) | v3.38.6, ~711KB unpacked |
| Tracing package ([`@langfuse/tracing`](https://www.npmjs.com/package/@langfuse/tracing)) | v5.0.1, ~468KB unpacked |
| OTel bridge ([`@langfuse/otel`](https://www.npmjs.com/package/@langfuse/otel)) | v5.0.1, ~136KB unpacked |
| License | MIT (client SDKs) |
| Maintenance | Very active; frequent releases |

### Integration with Vercel AI SDK

The recommended integration path is via **OpenTelemetry (OTel)**:

1. Install: `npm install @langfuse/tracing @langfuse/otel` [`@opentelemetry/sdk-node`](https://www.npmjs.com/package/@opentelemetry/sdk-node)
2. Initialize a `NodeTracerProvider` (NOT `@vercel/otel` -- incompatible with OTel JS SDK v2)
3. Enable telemetry in AI SDK calls
4. Traces appear in the Langfuse dashboard

**Important Next.js caveat:** You must use a manual OTel setup via `NodeTracerProvider`, not the `@vercel/otel` package, because `@vercel/otel` does not yet support OTel JS SDK v2 that the Langfuse packages require.

There is an official example repo: [langfuse/langfuse-vercel-ai-nextjs-example](https://github.com/langfuse/langfuse-vercel-ai-nextjs-example).

### Key Features to Demonstrate

| Feature | Demo Value | Implementation |
|---|---|---|
| **Tracing** | Shows every LLM call, tool invocation, latency | Automatic via OTel integration |
| **Sessions** | Group traces by user session / matter | Pass `sessionId` to trace metadata |
| **Prompt Management** | Version prompts in UI, deploy without code changes | Fetch prompts via SDK at runtime |
| **Evaluations/Scoring** | Rate AI suggestion quality | Attach scores (numeric, boolean, categorical) to traces |
| **Cost Tracking** | Token usage and cost per trace | Automatic with model pricing config |
| **User Feedback** | Thumbs up/down on suggestions | Score traces via API from frontend |

**Feasibility:** Straightforward. The OTel integration is well-documented. Cloud free tier (50K units/month) is more than enough for a demo.

**Cost Estimate:**

| Metric | Delta | Notes |
|---|---|---|
| Bundle impact | ~50-80KB gzipped (combined packages) | Tracing + OTel bridge |
| Dependencies | 3 new packages + OTel SDK | OTel SDK is the heaviest transitive dep |
| Complexity | 2/5 | Well-documented; example repo available |
| Cloud cost | $0 | 50K units/month free; demo will use <1K |

**Ecosystem:** Langfuse is the leading open-source LLM observability tool. Main competitor is [LangSmith](https://smith.langchain.com/) (LangChain's proprietary offering). Langfuse is provider-agnostic and framework-agnostic, which makes it a natural fit alongside Vercel AI SDK.

**Blockers:** None. The `@vercel/otel` incompatibility is a known issue with a documented workaround.

---

## 5. [Drizzle ORM](https://orm.drizzle.team/) + [Neon PostgreSQL](https://neon.tech/)

### [Drizzle ORM](https://orm.drizzle.team/)

| Attribute | Detail |
|---|---|
| Version | [0.45.2](https://www.npmjs.com/package/drizzle-orm) |
| Package size | ~10.4MB unpacked (includes all dialect drivers; tree-shakes) |
| License | Apache-2.0 |
| Maintenance | Very active |

**Key characteristics:**

- TypeScript-first ORM with SQL-like query builder
- Schema defined in TypeScript files (not YAML/JSON)
- [`drizzle-kit`](https://www.npmjs.com/package/drizzle-kit) (10.3MB) handles migrations: `drizzle-kit generate` + `drizzle-kit migrate`
- Native Neon support via [`drizzle-orm/neon-http`](https://orm.drizzle.team/docs/get-started/neon-new) driver

### [Neon PostgreSQL](https://neon.tech/)

| Attribute | Detail |
|---|---|
| [Free tier](https://neon.tech/pricing) storage | 0.5 GB per project |
| Free tier compute | 100 CU-hours/project/month |
| Free tier projects | Up to 100 |
| Egress | 5 GB/month |
| Connection | HTTP (serverless) or WebSocket |

**Key characteristics:**

- Serverless Postgres -- scales to zero, instant cold starts
- Branching (create DB branches like git branches)
- Acquired by Databricks in May 2025; prices dropped 15-25% post-acquisition
- The [`@neondatabase/serverless`](https://www.npmjs.com/package/@neondatabase/serverless) package (v1.0.2, ~410KB) provides HTTP and WebSocket drivers optimized for edge/serverless

### Setup for This Demo

**Installation:**
```
npm install drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit
```

**Connection (serverless HTTP -- recommended for Vercel):**
```typescript
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);
```

**Schema for a legal matter progression app would need tables like:**
- `matters` (id, type, title, current_stage, created_at, updated_at)
- `matter_stages` (id, matter_id, stage_name, status, started_at, completed_at)
- `matter_actions` (id, matter_id, stage_id, action_description, ai_suggested, completed)
- `conversations` (id, matter_id, messages JSONB, session_id)

**Feasibility:** Straightforward. Drizzle + Neon is the exact stack the company uses. First-class integration. Well-documented with official tutorials.

**Cost Estimate:**

| Metric | Delta | Notes |
|---|---|---|
| Bundle impact | Minimal after tree-shaking | Only neon-http driver imported |
| Storage | <1MB for demo data | 0.5GB free is more than enough |
| Compute | <5 CU-hours for demo | 100 CU-hours/month free is ample |
| Complexity | 1/5 | Schema + migrations is standard; excellent docs |

**Alternative considered:** SQLite via `better-sqlite3` or Turso. Rejected -- using Neon demonstrates direct stack alignment with the target company.

**Blockers:** None.

---

## 6. Legal Domain -- Matter Workflows

Understanding legal workflows is essential for building a convincing demo. Two practice areas are most relevant to the product: **residential conveyancing** and **family law**.

### Residential Conveyancing (Buyer's Side -- Australia)

A structured, predictable workflow -- ideal for AI-guided step suggestions.

| Stage | Key Tasks | Typical Duration |
|---|---|---|
| **1. Engagement & Onboarding** | Client identification (KYC), costs disclosure, retainer, conflict check | Day 1 |
| **2. Pre-Contract Review** | Receive contract from vendor's solicitor; review terms, special conditions, title, plan, easements, covenants | 1-2 weeks |
| **3. Searches & Investigations** | Local authority search, water/drainage, environmental, title search, strata (if applicable) | 2-8 weeks |
| **4. Pre-Contract Enquiries** | Raise requisitions on title, contract, and property; review vendor replies | 1-2 weeks |
| **5. Finance & Mortgage** | Confirm mortgage approval, review mortgage offer/conditions, coordinate with lender | 1-3 weeks |
| **6. Report to Client** | Summarize findings from searches and enquiries; advise on risks; obtain client sign-off | 1 week |
| **7. Exchange of Contracts** | Client signs contract; exchange with vendor's solicitor; deposit paid (usually 10%) | 1 day |
| **8. Pre-Settlement** | Prepare transfer documents, coordinate settlement figures, final inspection | 1-2 weeks |
| **9. Settlement** | Transfer funds via PEXA (electronic settlement platform in Australia); keys released | 1 day |
| **10. Post-Settlement** | Register transfer with Land Registry, confirm stamp duty payment, close file | 1-2 weeks |

**Total timeline:** 8-12 weeks for freehold; 10-14 weeks for leasehold.

### Family Law Matter (Australia)

Less predictable than conveyancing -- 97% of cases settle before final hearing.

| Stage | Key Tasks |
|---|---|
| **1. Initial Consultation** | Gather facts, identify issues (property, children, spousal maintenance), advise on options |
| **2. Pre-Action Procedures** | Mandatory: genuine steps letter, disclosure of financial info, attend mediation/FDR (Family Dispute Resolution) |
| **3. Filing (if no resolution)** | File Initiating Application + Affidavit with Federal Circuit and Family Court |
| **4. First Court Date** | 6-12 weeks after filing; procedural orders issued |
| **5. Interim/Interlocutory Hearings** | Urgent matters (parenting orders, property preservation); evidence gathering |
| **6. Conciliation / Mediation** | Court-directed conciliation conference; registrar-assisted negotiation |
| **7. Consent Orders (if settled)** | Formalize agreement as court orders; most matters resolve here |
| **8. Final Hearing (rare)** | Full trial with evidence; judge's determination; can take years to reach |

### Domain Modeling Insight

For the demo, **conveyancing is the better choice** because:
- It has a linear, predictable workflow (stages follow a clear sequence)
- Each stage has concrete, actionable tasks
- It is a high-volume practice area for the company's target market (small/medium law firms in Australia)
- It maps cleanly to a state machine that an AI agent can drive

Family law is more complex and branching -- better suited for a LangGraph-style implementation but harder to demo cleanly.

### Public Resources for Legal Workflow Modeling

- [NSW Law Society Conveyancing Guide](https://www.lawsociety.com.au/) -- professional body resources
- [PEXA (Property Exchange Australia)](https://www.pexa.com.au/) -- electronic settlement platform in Australia; the end-state of conveyancing
- [Federal Circuit and Family Court Practice Directions](https://www.fcfcoa.gov.au/fl/pd/fam-cpd) -- authoritative source for family law procedure
- [AustLII Pre-Action Procedures](https://classic.austlii.edu.au/au/legis/cth/consol_reg/fcafcoalr2021543/sch1.html) -- statutory rules for family law pre-action steps
- [College of Law -- Conveyancing Step-by-Step](https://www.collaw.edu.au/course-catalogue/cpd-on-demand/single-product/conveyancing-step-by-step-guide/) -- structured educational guide

---

## 7. Ecosystem Landscape

### Direct Competitors to Legal Agent Flow

| Tool | Type | Key Differentiator | Features Worth Noting |
|---|---|---|---|
| [**Harvey AI**](https://www.harvey.ai/) | AI legal platform (enterprise) | Custom LLMs trained on legal data; $5B+ valuation | **Workflow Builder**: self-serve tool for Innovation teams to build custom agents with natural language; integrates with iManage DMS |
| [**Clio Manage AI**](https://www.clio.com/) | Practice management + AI | AI embedded in existing practice management; market leader in SMB legal | **Manage AI**: auto-extracts deadlines from court docs, creates calendar events; **Clio Work**: AI research workspace synced with matter data |
| [**Smokeball**](https://www.smokeball.com/) | Practice management + automation | Document-centric automation; 20K+ automated forms | Workflow automation with template-attached tasks; auto-document creation; strongest in document assembly |
| [**CoCounsel (Thomson Reuters)**](https://legal.thomsonreuters.com/en/ai-assistant) | AI legal research | Backed by Westlaw and Practical Law content | Professional-grade research assistant; deep integration with Thomson Reuters content library |

### the company's Own AI Features

The company already has several AI features in production:
- **LawY**: AI legal Q&A with optional human-lawyer verification (unique "human-in-the-loop" twist)
- **Matter AI**: Interrogate matters and find details in seconds
- **the company Generator**: AI document drafting acceleration
- **AI Document Drafting**: Matter-specific first drafts

**The product is different from these** -- it is about workflow guidance and progression, not document drafting or Q&A. The product is closest to what Harvey's Workflow Builder does, but targeted at the SMB market that the company dominates.

### Differentiation Opportunity

The competitive landscape reveals a gap: most AI legal tools focus on **document processing** (drafting, review, research). Very few focus on **workflow orchestration and progression guidance** -- which is exactly what the product does. Harvey's Workflow Builder is the closest competitor, but it targets large law firms and is enterprise-priced.

A demo that shows **AI-driven matter progression** (not just document generation) directly addresses this underserved area and aligns with the company's positioning.

### Market Context

Global legal tech market: $20.81B (2025) projected to reach $65.51B by 2034. AI adoption in legal is accelerating but most firms are still in early stages.

---

## 8. Deployment -- [Vercel](https://vercel.com/)

### [Vercel Hobby (Free) Plan](https://vercel.com/pricing) Limits

| Resource | Limit | Notes |
|---|---|---|
| Function invocations | 150,000/month | More than enough for demo |
| Function duration (Fluid Compute) | 300 seconds (5 min) default | Sufficient for LLM streaming |
| Function duration (traditional) | 10 seconds | Too short for LLM calls -- must use Fluid Compute or streaming |
| Bandwidth | 100 GB/month | Ample |
| Edge requests | 1,000,000/month | Ample |
| Build minutes | 6,000/month | Ample |
| Memory | 2 GB / 1 vCPU (fixed) | Cannot upgrade on Hobby |

### Key Considerations for LLM-Powered Apps on Vercel

1. **Use streaming (`streamText`)**: Traditional serverless functions on Hobby timeout after 10 seconds. LLM calls take 5-30 seconds. Streaming sends data progressively and avoids the timeout. With Fluid Compute enabled, default duration is 300 seconds.

2. **Set `maxDuration`**: Export `maxDuration` from your route handler to extend timeout if needed. Hobby plan supports up to 300 seconds with Fluid Compute.

3. **Cold starts**: Neon serverless has near-instant cold starts via HTTP driver. No issue for demo.

4. **Environment variables**: Store API keys (Gemini, Langfuse, Neon) in Vercel project settings. Never commit to repo.

5. **Edge vs Node runtime**: Use Node.js runtime (not Edge) for the AI routes -- Edge has more restrictions and the OTel/Langfuse setup requires Node APIs.

**Feasibility:** Straightforward. The Hobby plan is sufficient for a demo project. The main gotcha is function duration -- use streaming and/or Fluid Compute.

**Blockers:** None for a demo. If this were production: Hobby plan pauses deployments when limits are hit (no overage purchasing), and memory is capped at 2GB.

---

## Feature Candidates

### Core Demo Features

#### FC-1: Matter Lifecycle Progression Agent

**What:** User selects a matter type (e.g., "Residential Conveyancing -- Buyer"), the app creates a matter with a defined stage workflow, and the AI agent analyzes current state to suggest next actions, flag risks, and track progress through stages.

**Feasibility:** Straightforward
**Key Libraries:**

| Library | Size Impact | Maintained? | License | Notes |
|---|---|---|---|---|
| `ai` (Vercel AI SDK) | ~6.5MB unpacked; ~50-100KB gzipped after tree-shake | Yes (daily releases) | Apache-2.0 | Core agent loop, streaming, tool calling |
| `@ai-sdk/google` | ~1.1MB unpacked | Yes | Apache-2.0 | Gemini provider |

**Cost Estimate:**

| Metric | Delta | Notes |
|---|---|---|
| Bundle | +~150KB gzipped | AI SDK + Google provider |
| Complexity | 3/5 | Agent loop + tool definitions + stage logic |
| LLM cost | $0 | Gemini free tier |
| Development time | 2-3 days | For the agent loop and tool definitions |

**Ecosystem:** This is the core of what the product does. Harvey's Workflow Builder is the closest competitor pattern. No existing open-source legal workflow agent exists.
**Blockers:** None
**Notes:** The agent should have tools like `get_current_stage`, `get_pending_tasks`, `mark_task_complete`, `suggest_next_actions`. The stage workflow should be data-driven (stored in DB or config), not hardcoded in prompts.

#### FC-2: Langfuse Observability Integration

**What:** Full LLM observability showing traces, spans, cost tracking, sessions, prompt versioning, and evaluation scoring for every agent interaction.

**Feasibility:** Straightforward
**Key Libraries:**

| Library | Size Impact | Maintained? | License | Notes |
|---|---|---|---|---|
| `@langfuse/tracing` | ~468KB unpacked | Yes | MIT | Core tracing SDK |
| `@langfuse/otel` | ~136KB unpacked | Yes | MIT | OTel bridge for AI SDK |
| `@opentelemetry/sdk-node` | ~varies | Yes | Apache-2.0 | OTel runtime |

**Cost Estimate:**

| Metric | Delta | Notes |
|---|---|---|
| Bundle | +~60-100KB gzipped | Tracing + OTel packages |
| Complexity | 2/5 | Well-documented; example repo exists |
| Cloud cost | $0 | 50K units/month free tier |

**Ecosystem:** Langfuse is the standard open-source LLM observability tool. Demonstrating it shows production-readiness thinking (not just "it works" but "we can monitor and debug it").
**Blockers:** Must use manual `NodeTracerProvider`, not `@vercel/otel`.
**Notes:** High interview impact -- shows you think about operability, not just functionality. Demonstrate: tracing an agent conversation, viewing cost per interaction, scoring suggestion quality, session replay.

#### FC-3: Drizzle + Neon PostgreSQL Data Layer

**What:** Matter state persistence with proper data modeling. Schema for matters, stages, actions, and conversation history.

**Feasibility:** Straightforward
**Key Libraries:**

| Library | Size Impact | Maintained? | License | Notes |
|---|---|---|---|---|
| `drizzle-orm` | ~10.4MB unpacked; tree-shakes heavily | Yes | Apache-2.0 | TypeScript ORM |
| `@neondatabase/serverless` | ~410KB unpacked | Yes | MIT | Serverless Postgres driver |
| `drizzle-kit` (dev) | ~10.3MB unpacked | Yes | Apache-2.0 | Migrations CLI |

**Cost Estimate:**

| Metric | Delta | Notes |
|---|---|---|
| Bundle | +~30-50KB gzipped (runtime) | Only neon-http driver in production bundle |
| DB cost | $0 | 0.5GB storage free; demo uses <1MB |
| Complexity | 1/5 | Standard schema + migrations |
| Development time | 0.5-1 day | Schema design + migration setup |

**Ecosystem:** Exact match to the company's stack. Drizzle + Neon is a well-documented, well-supported pairing with official tutorials from both sides.
**Blockers:** None.

### Stretch / High-Impact Features

#### FC-4: Provider-Agnostic Architecture

**What:** Demonstrate swapping between Gemini, Groq (Llama), and potentially OpenRouter models by changing one line. Show that the architecture is not locked to a single LLM provider.

**Feasibility:** Straightforward
**Key Libraries:**

| Library | Size Impact | Maintained? | License | Notes |
|---|---|---|---|---|
| `@ai-sdk/groq` | ~small | Yes | Apache-2.0 | Groq provider (optional) |

**Cost Estimate:**

| Metric | Delta | Notes |
|---|---|---|
| Bundle | +~20KB per additional provider | Minimal per-provider overhead |
| Complexity | 1/5 | Vercel AI SDK's core value prop |

**Ecosystem:** Provider agnosticism is a key architectural concern for any AI product. the company would want this -- they don't want to be locked to one model provider.
**Blockers:** None.
**Notes:** High interview impact with minimal effort. A settings page or env var toggle that switches models demonstrates strategic thinking about vendor risk.

#### FC-5: User Feedback Loop / Evaluation

**What:** Thumbs up/down on AI suggestions, feeding back into Langfuse as scores. Shows closing the feedback loop for continuous improvement.

**Feasibility:** Straightforward
**Key Libraries:** Uses existing Langfuse SDK (no new deps)

**Cost Estimate:**

| Metric | Delta | Notes |
|---|---|---|
| Bundle | +0KB | Uses existing Langfuse client |
| Complexity | 2/5 | Frontend buttons + score API call |

**Ecosystem:** User feedback is critical for AI products moving from PoC to production. Harvey and Clio both emphasize feedback loops. the company's own LawY feature has a "human verification" mechanism.
**Blockers:** None.
**Notes:** Very high interview impact. Shows you understand that AI quality is measured and improved iteratively, not just shipped.

#### FC-6: Prompt Management via Langfuse

**What:** Store system prompts and matter-type-specific prompts in Langfuse. Version them. Deploy prompt changes without code deploys.

**Feasibility:** Straightforward
**Key Libraries:** Uses existing Langfuse SDK

**Cost Estimate:**

| Metric | Delta | Notes |
|---|---|---|
| Bundle | +0KB | Uses existing Langfuse client |
| Complexity | 2/5 | Fetch prompts at runtime instead of hardcoding |

**Ecosystem:** Production AI apps separate prompt engineering from code deployment. This is a maturity signal. Langfuse supports A/B testing prompts and tracking performance per version.
**Blockers:** None.

---

## Technical Constraints

- **Vercel Hobby function duration:** Traditional serverless functions timeout at 10s on Hobby. LLM calls require streaming or Fluid Compute (300s default). Use `streamText` and export `maxDuration` in route handlers.
- **Gemini 2.5 Flash shutdown:** June 17, 2026. Not a blocker for a demo built now, but worth noting. Gemini 3 Flash is the migration path.
- **Neon free tier compute:** 100 CU-hours/month. Sufficient for demo but would need paid tier for any sustained usage. Auto-suspend after inactivity helps stay within limits.
- **Langfuse `@vercel/otel` incompatibility:** Must use manual `NodeTracerProvider` setup. Documented workaround; example repo available. Not a blocker, just a setup nuance.
- **Gemini free tier rate limits:** 10 RPM / 250 requests/day for 2.5 Flash. Fine for a demo; would be insufficient for any production use. Multiple concurrent users could exhaust daily quota.
- **Vercel Hobby memory cap:** Fixed at 2GB / 1 vCPU. Cannot upgrade. Should not be an issue for this demo but limits agent complexity.

---

## Security Flags

| Library | Issue | Severity | Action |
|---|---|---|---|
| `@opentelemetry/sdk-node` | No known CVEs found | N/A | Continue using |

_Libraries with no issues found: `ai`, `@ai-sdk/google`, `drizzle-orm`, `@neondatabase/serverless`, `@langfuse/tracing`, `@langfuse/otel`._
_Libraries not checked via CVE database (checked via web search only): all of the above. A deeper security audit was not performed -- these are all widely-used, actively-maintained packages from reputable maintainers._

---

## Confidence Notes

- **Gemini free tier rate limits:** HIGH confidence -- verified against official Google rate limits documentation (ai.google.dev) and multiple corroborating sources.
- **Gemini 2.5 Flash shutdown date (June 17, 2026):** MEDIUM confidence -- from a single search result citing Google deprecation notices. Verify on the official models page before relying on this date.
- **Gemini 3 Flash free tier availability:** MEDIUM confidence -- multiple sources confirm it exists in preview with free access, but exact rate limits for the free tier are not consistently documented.
- **Vercel AI SDK v6 Agent abstraction:** HIGH confidence -- verified against official Vercel blog post and ai-sdk.dev documentation.
- **Langfuse 50K units/month free tier:** HIGH confidence -- verified on langfuse.com/pricing.
- **Neon 100 CU-hours/month free tier:** HIGH confidence -- verified on neon.com/pricing and multiple corroborating sources.
- **Vercel Hobby 10s function timeout (traditional):** HIGH confidence -- official Vercel documentation.
- **Vercel Fluid Compute 300s default:** MEDIUM confidence -- referenced in Vercel docs but unclear if Fluid Compute is automatically enabled on Hobby or requires opt-in.
- **Mastra 22K+ GitHub stars / $13M seed:** HIGH confidence -- verified via GitHub and multiple news sources.
- **Groq free tier limits:** MEDIUM confidence -- community forum posts and third-party guides; Groq's official documentation is less clear on exact free tier limits.
- **OpenRouter free model count (29):** LOW confidence -- this number changes frequently as models enter and leave the free tier. Treat as approximate.
- **Legal workflow stages:** HIGH confidence -- cross-referenced across multiple Australian law firm guides and the College of Law curriculum.
- **npm package sizes:** HIGH confidence -- verified via `npm view` CLI against the live registry.
