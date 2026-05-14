# Kolliq — API Contract
## Node.js ↔ Django

**Version:** 1.0  
**Last updated:** May 2026  
**Internal auth header:** All Node→Django calls include `X-Internal-Secret: {DJANGO_API_SECRET}`

---

## Convention

- All request/response bodies are JSON (`Content-Type: application/json`)
- Phone numbers always in E.164 format: `+2348012345678`
- Monetary amounts in **kobo** (integer) unless stated otherwise
- Timestamps in ISO 8601: `2026-05-09T08:00:00Z`

---

## Endpoints Django Owns (Node calls these)

---

### POST `/api/users/create/`
**Called by:** Node — after OTP verification, after USSD registration  
**Purpose:** Create user account + trigger Squad virtual account creation

**Request:**
```json
{
  "phone": "+2348012345678",
  "user_type": "worker",
  "category": "Food & Provisions",
  "market": "Balogun Market",
  "income_range": "50000-150000"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `phone` | string | ✅ | E.164 format |
| `user_type` | string | ✅ | `worker` or `trader` |
| `category` | string | ❌ | Trader only |
| `market` | string | ❌ | Trader only |
| `income_range` | string | ❌ | Trader only |

**Success 201:**
```json
{
  "id": "uuid-here",
  "phone": "+2348012345678",
  "user_type": "worker",
  "virtual_account_number": "0123456789",
  "bank_name": "Squad MFB",
  "eis_score": 0
}
```

**Error 400:**
```json
{ "error": "User already exists" }
```

---

### GET `/api/wallets/`
**Called by:** Node — USSD balance check, WhatsApp score/balance check  
**Purpose:** Get wallet balance and EIS score for a user

**Query params:** `?phone=+2348012345678`

**Success 200:**
```json
{
  "virtual_account_number": "0123456789",
  "bank_name": "Squad MFB",
  "balance": "5000.00",
  "savings_balance": "1000.00",
  "eis_score": 47
}
```

**Error 404:**
```json
{ "error": "User not found" }
```

---

### POST `/api/payments/webhook/`
**Called by:** Node — after receiving and verifying Squad webhook  
**Purpose:** Record transaction, trigger EIS score recalculation

**Request:**
```json
{
  "phone": "+2348012345678",
  "amount": 500000,
  "account_number": "0123456789",
  "reference": "TRX_001",
  "type": "credit",
  "source": "squad_webhook",
  "sender_name": "Tunde Balogun"
}
```

**Success 200:**
```json
{ "status": "recorded" }
```

---

### POST `/api/jobs/create/`
**Called by:** Node — WhatsApp employer bot after collecting all job details  
**Purpose:** Create job listing, return escrow virtual account for payment

**Request:**
```json
{
  "employer_phone": "+2348099999999",
  "skill": "Motorcycle Rider",
  "workers_needed": 2,
  "pay_per_worker": 5000,
  "scheduled_time": "Tomorrow 8am",
  "location": "Surulere, Lagos"
}
```

**Success 201:**
```json
{
  "id": "JOB_001",
  "status": "pending_payment",
  "escrow_account_number": "9876543210",
  "escrow_bank": "Squad MFB",
  "total_escrow_amount": 10000
}
```

---

### GET `/api/jobs/fixed/`
**Called by:** Node — WhatsApp worker bot when worker says "find me work"  
**Purpose:** Return top 3 matched jobs for a worker

**Query params:** `?phone=+2348055555555`

**Success 200:**
```json
[
  {
    "id": "JOB_001",
    "skill": "Motorcycle Rider",
    "location": "Surulere, Lagos",
    "pay_per_worker": 5000,
    "scheduled_time": "Tomorrow 8am",
    "employer_name": "Alhaji Musa"
  },
  {
    "id": "JOB_002",
    "skill": "Cleaner",
    "location": "Ikeja, Lagos",
    "pay_per_worker": 3000,
    "scheduled_time": "Monday 9am",
    "employer_name": "Mrs Adeyemi"
  }
]
```

**Empty (no matches):**
```json
[]
```

---

### GET `/api/jobs/:id/`
**Called by:** Node — WhatsApp employer checking job status  
**Purpose:** Get current status of a specific job

**Success 200:**
```json
{
  "id": "JOB_001",
  "status": "in_progress",
  "skill": "Motorcycle Rider",
  "workers_needed": 2,
  "location": "Surulere, Lagos",
  "scheduled_time": "Tomorrow 8am",
  "pay_per_worker": 5000
}
```

**Job statuses:** `pending_payment`, `open`, `in_progress`, `completed`, `cancelled`

---

### POST `/api/jobs/accept/`
**Called by:** Node — WhatsApp worker bot when worker picks a job  
**Purpose:** Assign worker to job, notify employer via Redis pub/sub

**Request:**
```json
{
  "job_id": "JOB_001",
  "worker_phone": "+2348055555555"
}
```

**Success 200:**
```json
{ "status": "accepted", "job_id": "JOB_001" }
```

**Error 400:**
```json
{ "error": "Job already filled" }
```

---

### POST `/api/jobs/complete/`
**Called by:** Node — WhatsApp employer bot when employer says "job done"  
**Purpose:** Release escrow, credit worker wallet, update scores

**Request:**
```json
{
  "job_id": "JOB_001",
  "employer_phone": "+2348099999999"
}
```

**Success 200:**
```json
{
  "status": "completed",
  "amount_released": 10000,
  "worker_phone": "+2348055555555"
}
```

---

### GET `/api/financial/loans/eligibility/`
**Called by:** Node — WhatsApp when user says "apply loan"  
**Purpose:** Check if user qualifies for a loan

**Query params:** `?phone=+2348012345678`

**Success 200:**
```json
{
  "eligible": true,
  "score": 62,
  "loan_limit": 50000,
  "interest_rate": 0.05
}
```

**Not eligible:**
```json
{
  "eligible": false,
  "score": 34,
  "loan_limit": 0,
  "reason": "Score below minimum threshold of 50"
}
```

---

### POST `/api/financial/loans/apply/`
**Called by:** Node — WhatsApp after user confirms loan amount  
**Purpose:** Disburse loan from demo float to user wallet

**Request:**
```json
{
  "phone": "+2348012345678",
  "amount": 20000
}
```

**Success 201:**
```json
{
  "status": "disbursed",
  "amount": 20000,
  "fee": 1000,
  "total_repayment": 21000,
  "reference": "LOAN_001",
  "first_deduction": "2026-05-11"
}
```

---

### POST `/api/financial/loans/prepay/`
**Called by:** Node — WhatsApp when user wants to repay early

**Request:**
```json
{
  "phone": "+2348012345678",
  "amount": 10000
}
```

**Success 200:**
```json
{
  "status": "payment_recorded",
  "amount_paid": 10000,
  "remaining_balance": 11000
}
```

---

### POST `/api/financial/savings/deposit/`
**Called by:** Node — WhatsApp savings deposit flow

**Request:**
```json
{
  "phone": "+2348012345678",
  "amount": 5000
}
```

**Success 200:**
```json
{
  "status": "deposited",
  "amount": 5000,
  "savings_balance": 6000
}
```

---

### POST `/api/financial/savings/withdraw/`
**Called by:** Node — WhatsApp savings withdrawal flow

**Request:**
```json
{
  "phone": "+2348012345678",
  "amount": 2000
}
```

**Success 200:**
```json
{
  "status": "withdrawn",
  "amount": 2000,
  "savings_balance": 4000
}
```

**Insufficient funds 400:**
```json
{ "error": "Insufficient savings balance" }
```

---

### POST `/api/financial/insurance/activate/`
**Called by:** Node — WhatsApp when user activates insurance

**Request:**
```json
{ "phone": "+2348012345678" }
```

**Success 200:**
```json
{
  "status": "active",
  "daily_premium": 200,
  "coverage_limit": 5000
}
```

---

### POST `/api/financial/insurance/claim/`
**Called by:** Node — WhatsApp insurance claim flow

**Request:**
```json
{
  "phone": "+2348012345678",
  "amount": 3000
}
```

**Auto-approved (≤ ₦5,000) 200:**
```json
{
  "status": "approved",
  "amount": 3000,
  "reference": "CLM_001"
}
```

**Manual review (> ₦5,000) 200:**
```json
{
  "status": "under_review",
  "amount": 8000,
  "reference": "CLM_002",
  "eta": "48 hours"
}
```

---

## Endpoints Node Owns (Django calls these)

---

### POST `/webhooks/squad`
**Called by:** Squad payment gateway  
**Purpose:** Receive payment credit events for virtual accounts

**Headers:** `x-squad-encrypted-body: {HMAC-SHA512 signature}`

**Payload (Squad sends this):**
```json
{
  "Event": "virtual_account.credited",
  "Body": {
    "phone_number": "+2348012345678",
    "amount": 500000,
    "virtual_account_number": "0123456789",
    "transaction_reference": "TRX_001",
    "sender_name": "Tunde Balogun"
  }
}
```

**Response:** Always `200 { "status": "received" }` immediately (async processing)

---

## Redis Pub/Sub Contract

### Django publishes → Node listens

**Channel: `kolliq:jobs`**

```json
// job.matched — Django publishes after matching worker to a job
{
  "event": "job.matched",
  "worker_phone": "+2348055555555",
  "employer_name": "Alhaji Musa",
  "skill": "Rider",
  "location": "Surulere",
  "time": "Tomorrow 8am",
  "pay": "5000",
  "job_id": "JOB_001"
}

// job.accepted — Django publishes after worker accepts
{
  "event": "job.accepted",
  "employer_whatsapp": "whatsapp:+2348099999999",
  "worker_name": "Tunde Balogun",
  "worker_phone": "+2348055555555",
  "job_id": "JOB_001",
  "skill": "Rider",
  "location": "Surulere",
  "time": "Tomorrow 8am",
  "pay": "5000"
}

// job.completed — Django publishes after escrow release
{
  "event": "job.completed",
  "worker_phone": "+2348055555555",
  "employer_whatsapp": "whatsapp:+2348099999999",
  "job_id": "JOB_001",
  "amount": 500000
}
```

**Channel: `kolliq:financial`**

```json
// loan.disbursed
{
  "event": "loan.disbursed",
  "phone": "+2348012345678",
  "amount": 20000,
  "repayment_amount": 21000,
  "reference": "LOAN_001"
}

// loan.repayment_deducted
{
  "event": "loan.repayment_deducted",
  "phone": "+2348012345678",
  "amount": 3000,
  "remaining_balance": 18000
}

// insurance.claim_approved
{
  "event": "insurance.claim_approved",
  "phone": "+2348012345678",
  "amount": 3000,
  "reference": "CLM_001"
}

// score.updated
{
  "event": "score.updated",
  "phone": "+2348012345678",
  "old_score": 45,
  "new_score": 52
}
```

### Node publishes → Django listens

**Channel: `kolliq:payments`**

```json
// payment.credited
{
  "event": "payment.credited",
  "phone": "+2348012345678",
  "amount": 500000,
  "naira": "5000.00",
  "account_number": "0123456789",
  "reference": "TRX_001",
  "timestamp": "2026-05-09T08:00:00Z"
}

// escrow.released
{
  "event": "escrow.released",
  "phone": "+2348055555555",
  "amount": 500000,
  "naira": "5000.00",
  "reference": "TRX_002",
  "timestamp": "2026-05-09T10:00:00Z"
}
```

---

## Error Format

All errors follow this shape:

```json
{ "error": "Human readable message here" }
```

| Status | Meaning |
|---|---|
| 200 | Success |
| 201 | Created |
| 400 | Bad request / validation failed |
| 401 | Auth failed (wrong internal secret) |
| 404 | Resource not found |
| 500 | Server error |