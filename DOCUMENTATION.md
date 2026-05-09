# Kolliq Node.js Backend — Technical Documentation

**Version:** 1.0  
**Author:** Node.js Backend Engineer  
**Last updated:** May 2026

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication Flow](#2-authentication-flow)
3. [USSD Flow — Amina (Trader)](#3-ussd-flow--amina-trader)
4. [WhatsApp Bot — Alhaji Musa (Employer)](#4-whatsapp-bot--alhaji-musa-employer)
5. [WhatsApp Bot — Tunde (Worker)](#5-whatsapp-bot--tunde-worker)
6. [Squad Payment Webhook](#6-squad-payment-webhook)
7. [Notification System](#7-notification-system)
8. [Session Management](#8-session-management)
9. [Error Handling Strategy](#9-error-handling-strategy)
10. [Environment Configuration](#10-environment-configuration)
11. [Deployment](#11-deployment)
12. [Known Limitations](#12-known-limitations)

---

## 1. Architecture Overview

The Node.js service is the communication layer. It does not own any financial data or business logic — that lives in Django. Node owns:

- OTP authentication gateway
- USSD multi-step session handling
- WhatsApp bot conversation management
- Squad webhook receiver
- Push notification delivery (SMS + WhatsApp)

```
Africa's Talking ──► POST /ussd          ──► ussdController
                 ──► POST /auth/...      ──► authController

Twilio           ──► POST /whatsapp      ──► whatsappController

Squad            ──► POST /webhooks/squad ──► webhookController

Redis pub/sub    ──► notificationSubscriber ──► AT SMS + Twilio WhatsApp

Node             ──► Django REST API (all business logic lives here)
```

---

## 2. Authentication Flow

### How it works

OTP is generated in Node, stored in Redis with a 5-minute TTL, and sent via Africa's Talking SMS. On verification, Node confirms the OTP against Redis and then calls Django to create the user.

### Request OTP

```
POST /auth/request-otp
Body: { "phone": "+2348012345678" }
```

Internally:
1. Generate 6-digit OTP (`Math.random()`)
2. Store in Redis: `SET otp:{phone} {otp} EX 300`
3. Send SMS via Africa's Talking
4. Return `{ "message": "OTP sent successfully" }`

### Verify OTP

```
POST /auth/verify-otp
Body: { "phone": "+2348012345678", "otp": "482910" }
```

Internally:
1. `GET otp:{phone}` from Redis
2. Compare — if mismatch or nil → throw error
3. `DEL otp:{phone}` (one-time use)
4. `POST /api/users/create/` on Django
5. Return Django's user object

### OTP expiry

If the user requests a new OTP before the old one expires, the old key is overwritten. Redis TTL resets to 5 minutes on each new request.

---

## 3. USSD Flow — Amina (Trader)

### How Africa's Talking USSD works

Africa's Talking sends a POST to `/ussd` every time the user presses a number. The `text` field accumulates all inputs separated by `*`.

Example: User dials `*347*1234#`, selects 1, then selects 2 → `text = "1*2"`

Node parses `text.split('*')` to determine current depth and input.

### Response format

Responses must be plain text starting with `CON` (continue session) or `END` (close session). Africa's Talking kills the session after ~20 seconds of no response, so all Django calls must complete within 3 seconds.

### State machine

```
State 0 — Welcome
  ├── 1 → State 1: Trader path
  ├── 2 → State 2: Worker path (triggers OTP)
  ├── 3 → State 3: Member login
  └── 0 → END

State 1 — Trader Path
  ├── Step 1: What do you sell? (category)
  ├── Step 2: Which market?
  ├── Step 3: Monthly income range?
  └── Step 4: → POST /api/users/create/ → END + follow-up SMS

State 2 — Worker Path
  ├── OTP sent on entry
  ├── Step 1: Enter OTP
  └── On verify: → POST /api/users/create/ → END + follow-up SMS

State 3 — Member Login
  ├── Step 1: Enter phone number
  └── Step 2:
        ├── 1: Check balance → GET /api/wallets/
        ├── 2: Loan status (stub)
        └── 3: Repayment (stub)
```

### Session storage

Each USSD session is stored in Redis keyed by `ussd:{sessionId}` with a 5-minute TTL:

```json
{
  "state": 1,
  "path": "trader",
  "data": {
    "phone": "+2348012345678",
    "category": "Food & Provisions",
    "market": "Balogun Market"
  }
}
```

Sessions are cleared on `END` responses or on error.

### Follow-up SMS after registration

After every successful USSD registration, Node sends a follow-up SMS with the wallet number. This is because the USSD final screen is limited to ~182 characters and users may not copy the account number in time.

---

## 4. WhatsApp Bot — Alhaji Musa (Employer)

### How Twilio WhatsApp works

Twilio sends a POST to `/whatsapp` with form-encoded body. Key fields:
- `Body` — message text
- `From` — sender (e.g. `whatsapp:+2348099999999`)
- `To` — your Twilio number

Node replies with TwiML XML for inbound responses. For outbound messages (e.g. notifying employer when worker accepts), Node uses the Twilio client directly.

### Intent detection

Every new message (when session is `idle`) goes through Groq (llama-3.3-70b-versatile) for intent classification. The system prompt classifies into: `post_job`, `confirm_done`, `check_status`, `find_work`, `check_score`, `check_balance`, `apply_loan`, `savings_deposit`, `savings_withdraw`, `insurance_activate`, `insurance_claim`, `loan_prepay`, `help`, `unknown`.

A keyword fallback runs if Groq fails:

```js
if (text.includes('job') && text.includes('need')) return 'post_job';
if (text.includes('finish') || text.includes('done')) return 'confirm_done';
// etc.
```

### Job posting flow (multi-turn)

```
User: "I need a rider in Surulere"
Bot:  "What skill do you need?"        → step: job_collect_skill
User: "Motorcycle Rider"
Bot:  "How many workers?"              → step: job_collect_workers
User: "2"
Bot:  "How much per worker?"           → step: job_collect_pay
User: "5000"
Bot:  "What time and date?"            → step: job_collect_time
User: "Tomorrow 8am"
Bot:  "Which area?"                    → step: job_collect_area
User: "Surulere Lagos"
→ POST /api/jobs/create/ on Django
Bot:  "✅ Job posted! Escrow: ₦10,000 → Account: 9876543210 (Squad MFB)"
```

### Session storage

WhatsApp sessions stored as `wa:{phone}` in Redis with 30-minute TTL:

```json
{
  "step": "job_collect_pay",
  "data": {
    "skill": "Motorcycle Rider",
    "workers": 2
  }
}
```

---

## 5. WhatsApp Bot — Tunde (Worker)

### Finding work

```
User: "I wan find work"
→ GET /api/jobs/fixed/?phone={phone}
Bot:  Lists top 3 matched jobs with Job IDs
User: "1"
→ POST /api/jobs/accept/
Bot:  "🎉 Job accepted! Employer notified."
```

### Financial services

All financial flows follow the same pattern:
1. User states intent ("apply loan", "save money", etc.)
2. Bot asks for amount
3. Bot calls Django endpoint
4. Bot returns result

### Score milestones

When Django publishes a `score.updated` event to `kolliq:financial`, Node checks if the score crossed a threshold (30, 50, 70, 90) and sends an SMS to inform the user what they just unlocked.

---

## 6. Squad Payment Webhook

### Verification

Squad signs each webhook with HMAC-SHA512 using your webhook secret. The signature is in the `x-squad-encrypted-body` header.

```js
const hash = crypto
  .createHmac('sha512', process.env.SQUAD_WEBHOOK_SECRET)
  .update(rawBody)
  .digest('hex')
  .toUpperCase();
```

**Important:** The raw body must be captured before `express.json()` parses it. `app.js` handles this by intercepting `/webhooks/squad` first with `express.raw()`.

### Processing

Node responds `200` immediately, then processes async via `setImmediate`:

1. Forward to Django `POST /api/payments/webhook/`
2. Publish to Redis `kolliq:payments` channel
3. Send SMS to user via Africa's Talking

This pattern prevents Squad from retrying due to slow Django responses.

### Supported events

| Event | Action |
|---|---|
| `virtual_account.credited` | Forward to Django, SMS user, publish to Redis |
| `escrow.released` | Publish to Redis, SMS worker |

---

## 7. Notification System

### Architecture

A separate Redis subscriber connection (`notificationSubscriber.js`) runs alongside Express in the same process. It cannot share a connection with the main Redis client because ioredis subscriber connections are read-only.

```js
// server.js boots the subscriber as a side effect
import('./services/notificationSubscriber.js');
```

### Channels and events

**`kolliq:jobs`** — published by Django:
- `job.matched` → SMS to worker
- `job.accepted` → WhatsApp to employer + SMS to worker
- `job.completed` → SMS to worker + WhatsApp to employer

**`kolliq:payments`** — published by Node (webhookController):
- `payment.credited` → logged, Django handles score recalc
- `escrow.released` → logged

**`kolliq:financial`** — published by Django (Celery tasks):
- `loan.disbursed` → SMS to user
- `loan.repayment_deducted` → SMS to user
- `insurance.claim_approved` → SMS to user
- `score.updated` → SMS if milestone crossed

### SMS via Africa's Talking

All SMS go through `smsService.js` which wraps the Africa's Talking Node SDK. In sandbox mode, messages are simulated and not delivered to real phones. Switch `AT_USERNAME` from `sandbox` to your registered username for live delivery.

### WhatsApp outbound via Twilio

Outbound messages (not replies to inbound webhooks) use the Twilio REST client:

```js
twilioClient.messages.create({
  from: process.env.TWILIO_WHATSAPP_NUMBER,
  to: `whatsapp:${phone}`,
  body: message
});
```

---

## 8. Session Management

### USSD sessions

- Key: `ussd:{sessionId}` (sessionId from Africa's Talking)
- TTL: 5 minutes
- Cleared on: `END` response, error, or session completion

### WhatsApp sessions

- Key: `wa:{phone}` (full `whatsapp:+234...` string)
- TTL: 30 minutes (resets on each message)
- Cleared on: flow completion, error, or user cancels

### OTP storage

- Key: `otp:{phone}`
- TTL: 5 minutes
- Cleared on: successful verification (one-time use)

---

## 9. Error Handling Strategy

### USSD errors

All USSD errors end the session with an `END` message. The session is cleared. The user dials again to restart.

### WhatsApp errors

WhatsApp errors clear the session and return a TwiML reply asking the user to try again. The bot never crashes — Groq failures fall back to keyword detection.

### Django connection errors

If Django is unreachable (ECONNREFUSED), Node returns a user-facing error message. USSD sessions are cleared. WhatsApp sessions are cleared. The timeout on all Django calls is 5-8 seconds.

### Squad webhook errors

The webhook always returns `200` immediately. If async processing fails (Django down, Redis down), the error is logged. Squad does not retry because it already received a 200.

---

## 10. Environment Configuration

See `.env.example` for all variables. Key notes:

- `REDIS_URL`: Use `redis://localhost:6379` for local, `rediss://...` for Upstash (note double `s` for TLS)
- `AT_USERNAME`: Use `sandbox` for dev, your real username for production
- `SQUAD_BASE_URL`: Use sandbox URL for dev, switch to `https://api-d.squadco.com` for live
- `DJANGO_API_SECRET`: Shared secret agreed with Django partner — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## 11. Deployment

### Google Cloud Run

```bash
# Build and deploy
gcloud run deploy kolliq-node \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars PORT=8080

# Set secrets (do not put real keys in source)
gcloud run services update kolliq-node \
  --set-env-vars REDIS_URL=rediss://...,AT_API_KEY=...,SQUAD_SECRET_KEY=...
```

### After deployment

1. Copy your Cloud Run URL (e.g. `https://kolliq-node-xyz-uc.a.run.app`)
2. Register it in Squad dashboard → Webhooks → URL: `{your-url}/webhooks/squad`
3. Register it in Twilio → WhatsApp sandbox → Webhook URL: `{your-url}/whatsapp`
4. Register USSD callback in Africa's Talking → USSD → Callback URL: `{your-url}/ussd`

---

## 12. Known Limitations

**USSD 3-second timeout:** Africa's Talking kills sessions if no response within ~20 seconds total, and each step should respond in under 3 seconds. If Django is slow, USSD steps that call Django (registration, balance check) may timeout. Mitigation: Django calls in USSD have a 4-5 second timeout; if they fail, the user gets an `END` error screen and must redial.

**WhatsApp sandbox limits:** In Twilio sandbox, only phone numbers that have joined the sandbox (by sending a join code to the Twilio number) can receive messages. This limits testing to phones you control. Production requires Meta Business verification.

**Groq cold start:** Groq API occasionally has latency on the first call. The keyword fallback ensures the bot never returns an empty response even if Groq is slow or down.

**No webhook retry handling:** Squad webhooks always receive a 200, so Squad never retries. If Node's async processing fails (Django down), the event is lost. For production, consider storing raw Squad payloads in Redis before processing as a simple dead-letter queue.

**Redis single point of failure:** If Redis goes down, OTP storage, USSD sessions, and WhatsApp sessions all fail simultaneously. Upstash has 99.9% uptime SLA. For local dev, restart Redis with `brew services restart redis`.