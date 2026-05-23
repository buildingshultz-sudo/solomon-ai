# Building Shultz: Signal-Monitoring Module Design

**System:** Solomon AI (Node.js VPS Architecture)  
**Purpose:** Autonomous identification, scoring, and initial outreach drafting for high-probability trade business prospects.

This document outlines the architecture and operational logic for Solomon's Signal-Monitoring Module. The goal of this module is to continuously scan the digital landscape for specific indicators that a trade business (HVAC, plumbing, electrical, etc.) is in acute need of AI automation services, and to prepare a tailored pitch for Jedidiah's review.

---

## 1. What Signals to Monitor

Solomon will be programmed to detect specific behavioral and digital footprints that indicate operational bottlenecks or growth phases.

*   **Stale/Old Advertising:** Businesses running the exact same Facebook/Instagram ads for more than 60 days without variation. This indicates a lack of content creation capability or an abandoned marketing effort.
*   **Misaligned Hiring Needs:** Companies posting job listings for entry-level marketing, social media management, or administrative/dispatch roles. These are tasks perfectly suited for AI automation at a fraction of the cost.
*   **Rapid Expansion:** Businesses that have recently updated their profiles to include new locations, expanded service areas, or have press releases/posts announcing new fleet vehicles.
*   **The "Good Work, Bad Tech" Profile:** Companies with excellent customer reviews (4.5+ stars) but poorly designed websites, no online booking options, or lack of chat functionality. They have the operational chops but lack digital scale.
*   **High Effort, Low Yield Socials:** Businesses actively posting on social media (3+ times a week) but receiving very low engagement (few likes, no comments), indicating a need for AI-optimized content and strategy.

---

## 2. Where to Monitor (Data Sources)

To capture these signals, Solomon will interface with the following platforms:

*   **Meta Ad Library:** To track the duration, frequency, and creative variation of active advertisements run by local trade businesses.
*   **Job Boards (Indeed, LinkedIn):** To monitor new job postings filtered by industry (trades/construction) and role (admin, marketing, dispatch).
*   **Google Business Profiles (Google Maps API):** To scrape review scores, review volume, website links, and recent updates regarding service areas or business hours.
*   **Facebook Business Pages / Instagram Profiles:** To analyze posting frequency, engagement metrics, and responsiveness to customer comments.

---

## 3. How Solomon Processes Signals

Once data is ingested, Solomon will process the information through a multi-step pipeline to generate actionable leads.

### A. Scoring the Prospect (1-10 Scale)
Solomon will assign a weighted score based on signal strength and combinations:
*   **Base Score (1-3):** Single weak signal (e.g., stale ads only).
*   **Medium Score (4-7):** Strong single signal (e.g., hiring an admin) or combination of weak signals.
*   **High Score (8-10):** The "Perfect Storm" (e.g., Hiring an admin + expanding service area + stale ads). Scores of 8+ trigger immediate priority alerts.

### B. Generating the Tailored Pitch
Based on the specific signals detected, Solomon's LLM component will generate a customized angle.
*   *If hiring an admin:* "I saw you're looking to hire a dispatcher at $45k/year. We can automate 80% of that workload for $2,500/month..."
*   *If stale ads:* "Your current Meta ads have been running since March. Our AI video generation can create 10 fresh, localized variations by tomorrow..."

### C. Drafting the Outreach Message
Solomon will draft a complete, professional email or direct message based on the tailored pitch. This draft will be placed in a "Pending Review" queue. The message will include placeholders for any manual personalization Jedidiah wishes to add.

### D. Database Tracking
All prospects, their scores, detected signals, and drafted messages will be logged into a centralized database. This ensures no duplicate outreach and allows for tracking the conversion rate of different signal types.

---

## 4. Technical Implementation Plan

The module will be built as an extension of Solomon's existing Node.js environment on the VPS.

### APIs and Scraping Tools
*   **Meta Graph API / Unofficial Ad Library Scrapers:** For accessing Facebook/Instagram page data and active ad details. (Note: Ad Library API access requires approval; Puppeteer/Playwright may be needed as a fallback for scraping).
*   **SerpApi (or similar Google search API):** To query Google Jobs, Indeed, and LinkedIn job postings efficiently without managing complex scraper proxies.
*   **Google Places API:** To pull Google Business Profile data, reviews, and website URLs.
*   **Puppeteer/Playwright:** For headless browser scraping of social media engagement metrics where APIs are restrictive.
*   **OpenAI API (GPT-4o):** For natural language processing, signal interpretation, and drafting the tailored outreach messages.

### Data Storage Approach
*   **Database:** PostgreSQL or MongoDB. PostgreSQL is recommended if we want strict relational mapping between businesses, signals, and outreach attempts. MongoDB is suitable if the scraped data structures vary wildly.
*   **ORM/Query Builder:** Prisma (if PostgreSQL) or Mongoose (if MongoDB) for easy integration with Node.js.

### Integration with Solomon's Architecture
1.  **Cron Jobs/Schedulers:** Utilize `node-cron` to schedule the monitoring tasks. (e.g., Check job boards daily at 2 AM; check Meta Ad Library weekly).
2.  **Worker Queues:** Implement a queue system (like BullMQ backed by Redis) to handle the scraping and API calls asynchronously, preventing the main Node.js thread from blocking.
3.  **Dashboard/Interface:** Create a simple internal web dashboard (Express.js + basic front-end) where Jedidiah can view the "Pending Review" queue, approve/edit drafted messages, and dispatch them.

### Estimated Development Timeline (4-6 Weeks)
*   **Week 1:** Database schema design, environment setup, and integration of the Google Places API.
*   **Week 2:** Implementation of Job Board scraping/API integration and Meta Ad Library monitoring.
*   **Week 3:** Development of the scoring algorithm and OpenAI integration for drafting tailored pitches.
*   **Week 4:** Building the internal review dashboard and queue system for Jedidiah.
*   **Week 5-6:** Testing, debugging headless browser scrapers (handling rate limits/proxies), and final deployment to the VPS.
