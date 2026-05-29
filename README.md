<div align="center">

<img src="https://img.shields.io/badge/HydroSense-v3.0-0ea5e9?style=for-the-badge&logoColor=white" />

# 💧 HydroSense
### Climate-Resilient Rural Water & Environment Management System

*Empowering Uganda's communities through intelligent water stewardship*

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-24+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Status](https://img.shields.io/badge/Status-Live-brightgreen?style=flat-square)]()

<br />

> **HydroSense** is a full-stack, enterprise-grade water resource management and environmental monitoring platform built for Uganda's Ministry of Water & Environment. It connects national administrators, district officers, field technicians, health officers, climate scientists, NGOs, community committees, and citizens on a single secure platform — enabling real-time incident reporting, proximity-based task dispatch, AI-powered analysis, and community-driven environmental stewardship.

<br />

[🚀 Live Demo](https://veltrix-4r2c.vercel.app) · [🐛 Report Bug](https://github.com/muzoora2000/veltrix/issues) · [💡 Request Feature](https://github.com/muzoora2000/veltrix/issues)

</div>

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Tech Stack](#-tech-stack)
- [User Roles & Access](#-user-roles--access)
- [Modules](#-modules)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Deployment](#-deployment)
- [Authors](#-authors)

---

## 🌍 Overview

Uganda faces a critical water crisis — over **60% of rural communities** lack access to safe, reliable water. Contamination, infrastructure failure, and delayed government response cost lives daily.

**HydroSense** was built to change that.

It is a unified platform that connects IoT sensors, citizen reporters, field technicians, health officers, climate scientists, and national administrators into a single, intelligent ecosystem. Every report, sensor reading, and maintenance request flows through a real-time pipeline that triggers the right response — automatically.

### What makes it different

- **Proximity-based task assignment** — Haversine distance formula automatically dispatches the nearest available technician the moment a report is submitted, using GPS from the citizen's phone
- **Real climate data** — 6-month rainfall forecasts sourced live from Open-Meteo historical climate records, not simulated numbers
- **District-controlled committee access** — Community Committee members receive a unique `HSC-CC-{DISTRICT}-{YEAR}-{SEQ}` identity code, managed by District Officers, not self-registered
- **Full OTP email delivery** — Forgot-password and account verification via Resend transactional email
- **Real-time push** — Socket.IO delivers new alerts and notifications to the browser instantly, not on a 30-second poll

---

## ✨ Key Features

### 📡 Real-Time Monitoring
- **IoT Sensor Dashboard** — live readings from water quality sensors (pH, turbidity, TDS, flow rate) via Socket.IO WebSocket
- **Climate Intelligence** — real drought index (SPI), flood alerts, and 6-month rainfall forecast from Open-Meteo API with WMO fallback
- **Water Quality Lab** — lab test submissions with automatic WHO safe-drinking-water threshold alerts

### 🗺️ GIS & Spatial Intelligence
- **Interactive Leaflet Map** — all water points, drought zones, and flood risk areas on a live Uganda map, offline-capable (SVG pin icons, no CDN dependency)
- **3 switchable layers** — Water Points · Drought Index · Flood Risk
- **Click-to-inspect** — popup shows point name, status, and beneficiary count

### 🤖 AI Intelligence Hub (Gemini 2.5 Flash)
- **AI Chatbot** — context-aware Gemini-powered assistant with full environmental data access and streaming responses
- **Incident Analysis Engine** — automated risk scoring, priority classification, and duplicate detection
- **Predictive Analytics** — borehole failure probability, drought risk, flood probability, derived from real DB metrics
- **Multilingual Voice Input** — voice reports transcribed and translated across 10+ Ugandan languages

### 🏘️ District-Controlled Committee System
- **Committee ID** — unique `HSC-CC-KAM-2026-0001` identifiers auto-generated per district, used for login
- **Dual login modes** — Email (staff/citizens) and Committee ID (community committee members)
- **Committee governance** — meetings, incidents, projects, announcements, and votes with instant in-app notifications to all members

### 📣 Instant Notifications
- **Personal per-member delivery** — committee meeting/announcement/incident/vote notifications pushed individually via Socket.IO `new_alert` + `new_notification` events
- **Role-aware routing** — clicking a notification navigates to the exact relevant page
- **Bell badge** — increments in real-time without polling

### 📝 Multi-channel Citizen Reporting
- **Standard and multilingual report forms** — 8 incident types, GPS capture, anonymous option, photo/video/audio attachments
- **Proximity auto-assign** — as soon as a report is submitted, the system scores all available technicians by (distance from incident) + (open-task penalty) + (role suitability) and assigns instantly
- **Status tracking** — citizens follow their report through Submitted → Investigating → Assigned → Resolved

### 🏥 Public Health Integration
- **Disease outbreak tracker** — Cholera, Typhoid, Diarrhea, Dysentery, Hepatitis A, Schistosomiasis
- **Automatic outbreak alert** — triggered when cases ≥ 10 in a district
- **Water-linked incident tagging** — connects health incidents to specific water points

### ⚡ Emergency Response
- **Emergency Center** — real-time alert panel with severity levels (Emergency · Critical · Warning · Info)
- **Acknowledge / Resolve** — officers update status; Socket.IO pushes the change to all connected clients instantly
- **Incident Command** — multi-agency coordination with escalation to national level

### 🔐 Security & Governance
- **JWT + bcrypt** — all sessions token-secured, passwords hashed at cost 10
- **Role-Based Access Control (RBAC)** — 8 roles, 25+ route guards, API-level `requireRole()` enforcement
- **Full audit trail** — every CREATE, UPDATE, DELETE, APPROVE, RESOLVE, DISPATCH action logged with actor and timestamp
- **OTP password reset** — 6-digit OTP delivered via Resend, bcrypt-hashed in DB, single-use, 5-minute expiry

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    HYDROSENSE PLATFORM                          │
├──────────────────┬──────────────────────┬───────────────────────┤
│  Vercel          │  Render (Node.js)    │  Render (Python)      │
│  React + Vite    │  Express + Socket.IO │  FastAPI + Gemini AI  │
│  Static frontend │  REST API + RBAC     │  AI microservice      │
│  veltrix-4r2c    │  hydrosense-server   │  hydrosense-ai        │
│  .vercel.app     │  .onrender.com       │  .onrender.com        │
└──────────────────┴──────────┬───────────┴───────────────────────┘
                              │
                   ┌──────────▼──────────┐
                   │   PostgreSQL DB      │
                   │   Render Managed     │
                   │   Shared by both     │
                   │   Node.js + Python   │
                   └─────────────────────┘
```

**Request flow:**
1. Browser → Vercel (static assets)
2. `/api/*` → Vercel rewrites to → Render `hydrosense-server`
3. `/api/ai/*` → `hydrosense-server` proxies to → `hydrosense-ai`
4. Socket.IO → direct WebSocket to `hydrosense-server`

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS |
| **State & Routing** | React Router v6, Context API |
| **Charts** | Recharts |
| **Maps** | Leaflet, React-Leaflet (offline SVG icons) |
| **Real-time** | Socket.IO Client + Server |
| **Backend** | Node.js 24, Express.js |
| **Database** | PostgreSQL (Render managed) |
| **Authentication** | JWT (jsonwebtoken), bcryptjs |
| **Scheduling** | node-cron |
| **Email** | Resend (primary) → Brevo → SendGrid → Gmail SMTP |
| **SMS** | Africa's Talking |
| **AI Service** | Python 3.11, FastAPI, Uvicorn |
| **AI Model** | Google Gemini 2.5 Flash |
| **Climate Data** | Open-Meteo Archive API (free, no key) |
| **Deployment** | Vercel (frontend), Render (Node + Python) |

---

## 👤 User Roles & Access

| Role | Description | Login method |
|------|-------------|--------------|
| `national_admin` | Full system access — all districts, all users, governance | Email |
| `district_officer` | District-level management — creates committee accounts, assigns tasks | Email |
| `technician` | Field work — sensors, maintenance, task completion | Email |
| `health_officer` | Water quality and disease surveillance | Email |
| `climate_scientist` | Climate monitoring, drought/flood analysis, predictions | Email |
| `ngo_officer` | Community reports, GWN, water quality access | Email |
| `community_committee` | Local water governance — meetings, incidents, projects | Committee ID (`HSC-CC-…`) |
| `citizen` | Report incidents, track submissions, community hub | Email |

### How committee accounts work
District Officers create committee member accounts via **Committee Management → Committee Accounts**. The system auto-generates a unique ID (`HSC-CC-KAM-2026-0001`). The member logs in at the **Committee ID tab** on the login page using that ID and the temporary password assigned by the officer.

---

## 📦 Modules

| Module | Description | Roles |
|--------|-------------|-------|
| Dashboard | Role-specific KPI cards, live map, weather, alerts | All |
| Water Infrastructure | Registry of all water points with GPS, status, sensors | All |
| IoT Sensors | Live sensor readings via WebSocket, 24h charts | Admin, Officer, Technician, Health, Climate |
| Climate Monitor | SPI drought index, flood alerts, 6-month rainfall forecast | Admin, Officer, Health, Climate |
| Water Quality | Lab tests, WHO threshold checking, contamination alerts | Admin, Officer, Health, NGO, Climate |
| Maintenance | Work orders from creation to completion, fund tracking | Admin, Officer, Technician |
| Community Reports | Citizen-submitted reports across all channels | Admin, Officer, Committee, NGO, Citizen |
| Health Surveillance | Disease tracking, outbreak detection, case mapping | Admin, Officer, Health, NGO |
| Emergency Center | Real-time alerts, acknowledge/resolve, response tickets | Admin, Officer, Health |
| GIS Map | Leaflet map — water points, drought, flood layers | Admin, Officer, Climate, NGO, Health, Committee |
| Analytics | AI-driven water security, predictions, climate risk | Admin, Officer, Climate, Health |
| AI Hub | Gemini chatbot, risk summaries, incident analysis, reports | Admin, Officer, Technician, Health, Climate |
| Governance | Audit log, budget tracking, transparency reporting | Admin, Officer |
| User Management | Full CRUD + QR badge generation | Admin |
| Technician Portal | Personal task queue (Pending / In Progress / Done) | All |
| Citizen Hub | Community forum, volunteer events, achievements | All |
| Guardian Water Network | Crowdsourced pollution reporting with community voting | All |
| Citizen Report | Incident submission with GPS, media, anonymous option | Citizen, Committee, NGO |
| Multilingual Report | 3-step form with voice recording and AI translation | Citizen, Committee, NGO |
| Track Reports | Personal report history with status timeline | Citizen, Committee, NGO |
| Task Assignment | Manual + proximity-based auto-assignment | Admin, Officer, Technician, Health |
| Committee Management | Committees, members, meetings, incidents, projects, votes | Admin, Officer, Committee |
| Incident Analysis | AI batch analysis of pending reports | Admin, Officer, Health, Climate |
| Profile | Name, phone, avatar, password change — every user | All |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL 15+

### Local installation

```bash
# 1. Clone
git clone https://github.com/muzoora2000/veltrix.git
cd veltrix

# 2. Backend
cd server && npm install
cp .env.example .env   # fill in DATABASE_URL, GEMINI_API_KEY, RESEND_API_KEY

# 3. Frontend
cd ../client && npm install

# 4. AI service
cd ../ai-service
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Running locally

Open three terminals:

```bash
# Terminal 1 — Backend (port 5000)
cd server && npm run dev

# Terminal 2 — Frontend (port 5173)
cd client && npm run dev

# Terminal 3 — AI Service (port 8000)
cd ai-service && uvicorn main:app --reload --port 8000
```

App available at **http://localhost:5173**

---

## 🔐 Environment Variables

### `server/.env`

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default 5000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for JWT signing |
| `GEMINI_API_KEY` | Google Gemini API key |
| `RESEND_API_KEY` | Resend transactional email key |
| `EMAIL_FROM_NAME` | Sender display name |
| `AI_SERVICE_URL` | Deployed AI service URL (production only) |
| `AT_API_KEY` | Africa's Talking SMS key |

### `ai-service/.env`

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key |
| `DATABASE_URL` | PostgreSQL connection string |

---

## ☁️ Deployment

HydroSense runs across three cloud services:

| Service | Platform | URL |
|---------|----------|-----|
| Frontend (React) | Vercel | `veltrix-4r2c.vercel.app` |
| Backend (Node.js) | Render | `hydrosense-server.onrender.com` |
| AI Service (Python) | Render | `hydrosense-ai.onrender.com` |
| Database | Render PostgreSQL | Managed, internal access only |

### Render environment variables required

**hydrosense-server:** `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `AI_SERVICE_URL`

**hydrosense-ai:** `DATABASE_URL`, `GEMINI_API_KEY`

---

## 👨‍💻 Authors

<div align="center">

**HydroSense — Bachelor of Software Engineering**

Cavendish University Uganda

[![GitHub](https://img.shields.io/badge/GitHub-muzoora2000-181717?style=flat-square&logo=github)](https://github.com/muzoora2000)

</div>

---

<div align="center">

**HydroSense** — *Because clean water is not a privilege. It is a right.*

⭐ Star this repository if you believe in what it stands for.

</div>
