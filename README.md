# Kolliq — Node.js Microservice

The communication layer for the Kolliq fintech platform. Handles OTP authentication, USSD flows, WhatsApp bot, Squad payment webhooks, and real-time push notifications via Redis pub/sub.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js v22+ (ESM modules) |
| Framework | Express.js |
| Session Store | Redis (local dev) / Upstash (production) |
| SMS / USSD | Africa's Talking |
| Payments | Squad by GTCo |
| WhatsApp | Twilio |
| Intent Detection | Groq (llama-3.3-70b-versatile) |
| Deployment | Google Cloud Run |

---

## Project Structure

```
trybe-node/
├── src/
│   ├── app.js                    # Express setup, middleware, route mounts
│   ├── server.js                 # Entry point, boots server + subscriber
│   ├── config/
│   │   └── redis.js              # ioredis client (handles local + TLS)
│   ├── routes/
│   │   ├── auth.js               # POST /auth/request-otp, /auth/verify-otp
│   │   ├── ussd.js               # POST /ussd
│   │   ├── whatsapp.js           # GET + POST /whatsapp
│   │   └── webhooks.js           # POST /webhooks/squad, /webhooks/whatsapp
│   ├── controllers/
│   │   ├── authController.js     # OTP request and verify logic
│   │   ├── ussdController.js     # Full USSD state machine
│   │   ├── whatsappController.js # WhatsApp bot (employer + worker)
│   │   └── webhookController.js  # Squad webhook receiver
│   ├── services/
│   │   ├── otpService.js         # OTP generate, store, verify
│   │   ├── smsService.js         # Africa's Talking SMS wrapper
│   │   ├── ussdSessionService.js # USSD Redis session helpers
│   │   ├── squadService.js       # Squad API wrapper
│   │   └── notificationSubscriber.js  # Redis pub/sub listener
│   └── middleware/
│       └── validateWebhook.js    # Internal webhook auth
├── .env.example
└── package.json
```

---

## Getting Started

### Prerequisites
- Node.js v22+
- Redis running locally (`brew install redis && brew services start redis`)

### Installation

```bash
git clone https://github.com/your-org/kolliq-node.git
cd kolliq-node
npm install
cp .env.example .env
# Fill in your .env values (see Environment Variables below)
npm run dev
```

### Verify it's running

```bash
curl http://localhost:8040/health
# {"status":"ok","service":"trybe-node"}
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
PORT=8040
NODE_ENV=development

# Redis
REDIS_URL=redis://localhost:6379

# Africa's Talking
AT_API_KEY=
AT_USERNAME=sandbox
AT_SENDER_ID=KOLLIQ

# Django backend
DJANGO_API_URL=http://localhost:8000
DJANGO_API_SECRET=

# Squad
SQUAD_SECRET_KEY=
SQUAD_PUBLIC_KEY=
SQUAD_WEBHOOK_SECRET=
SQUAD_BASE_URL=https://sandbox-api-d.squadco.com

# OTP
OTP_TTL_SECONDS=300
OTP_LENGTH=6

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# Groq
GROQ_API_KEY=

# Internal
WEBHOOK_SECRET=
```

---

## API Endpoints

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/request-otp` | Send OTP via SMS to phone number |
| POST | `/auth/verify-otp` | Verify OTP, create user on Django |

### USSD
| Method | Endpoint | Description |
|---|---|---|
| POST | `/ussd` | Africa's Talking USSD handler |

### WhatsApp
| Method | Endpoint | Description |
|---|---|---|
| GET | `/whatsapp` | Twilio webhook verification |
| POST | `/whatsapp` | Inbound WhatsApp message handler |

### Webhooks
| Method | Endpoint | Description |
|---|---|---|
| POST | `/webhooks/squad` | Squad payment event receiver |
| POST | `/webhooks/whatsapp` | Twilio delivery status |

### Health
| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Service health check |

---

## Redis Keys

| Key Pattern | TTL | Purpose |
|---|---|---|
| `otp:{phone}` | 5 min | OTP storage |
| `ussd:{sessionId}` | 5 min | USSD session state |
| `wa:{phone}` | 30 min | WhatsApp conversation state |

## Redis Pub/Sub Channels

| Channel | Publisher | Subscriber | Events |
|---|---|---|---|
| `kolliq:jobs` | Django | Node | `job.matched`, `job.accepted`, `job.completed` |
| `kolliq:payments` | Node | Django + Node | `payment.credited`, `escrow.released` |
| `kolliq:financial` | Django | Node | `loan.disbursed`, `loan.repayment_deducted`, `insurance.claim_approved`, `score.updated` |

---

## Scripts

```bash
npm run dev      # Start with hot reload (node --watch)
npm start        # Production start
```

---

## Notes

- All Django calls include the header `X-Internal-Secret` for internal auth
- Squad webhook responds 200 immediately, processes async via `setImmediate`
- USSD responses must arrive within 3 seconds (Africa's Talking timeout)
- WhatsApp uses TwiML for inbound replies, Twilio client for outbound messages
- Groq intent detection includes a keyword fallback in case of API failure