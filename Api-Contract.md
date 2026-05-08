# KOLLIQ Platform API Contract v1.0.0
**Last Updated:** December 25, 2024
**Owners:** @django-dev @node-dev

> 🚨 **GOLDEN RULE:** If you change an API, update this file BEFORE pushing code. Both developers must approve API changes.

---

## 📋 Table of Contents
1. [Authentication Flow](#authentication-flow)
2. [User Management](#user-management)
3. [Job System](#job-system)
4. [Payment System](#payment-system)
5. [Financial Services](#financial-services)
6. [Webhooks](#webhooks)
7. [Error Handling](#error-handling)

---

## 🔐 Authentication Flow

### Node → Django: Create User
**Endpoint:** `POST /api/users/create/`  
**Called by:** Node (after OTP verification)  
**Purpose:** Create user account and virtual wallet

**Request Body:**
```json
{
  "phone": "+2348123456789",      // Required, E.164 format
  "full_name": "Tunde Ade",        // Required
  "role": "worker",                // Required: worker | trader | employer
  "skills": "delivery",            // Optional: delivery | cooking | construction | market_assistant | cleaning | security | teaching | other
  "languages": "english,yoruba",   // Optional: comma-separated
  "has_vehicle": true,             // Optional: true/false
  "location_lat": 6.5244,          // Optional: latitude
  "location_lng": 3.3792,          // Optional: longitude
  "location_name": "Surulere"      // Optional: area name
}
