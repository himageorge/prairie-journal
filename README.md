# Prairie Journal

A Chrome extension that helps students learn from their mistakes on [PrairieLearn](https://www.prairielearn.com). When you get a practice question wrong, Prairie Journal lets you reflect on your reasoning, get Socratic hints from AI, and build a personal journal of mistakes to review later.

## Features

- **Automatic mistake detection** — detects wrong answers on PrairieLearn practice questions and prompts you to journal the mistake
- **Reflection side panel** — write your reasoning, capture a screenshot, and get AI-powered Socratic hints
- **AI hints via Gemini** — guided hints based on your specific reasoning, not just the answer
- **Dashboard** — browse all past mistakes organized by course and module, with starred entries and smart review reminders
- **Persistent storage** — all entries saved locally in your browser

## Setup

1. Clone or download this repository
2. Create a `config.js` file in the project root with your [Google Gemini API key](https://aistudio.google.com/app/apikey):
   ```js
   export const API_KEY = "your-gemini-api-key-here";
   export const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
   ```
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked** and select the project folder

## Usage

1. Navigate to a PrairieLearn practice assessment 
2. Submit an incorrect answer — a **"Journal This Mistake"** button will appear
3. Click it to open the side panel
4. Write your reflection explaining what you were thinking
5. Press **Enter** to get a Socratic hint from the AI
6. Add a quick note summarizing your takeaway, then click **Save Entry**
7. Open the **Dashboard** to review all past mistakes by course

## Tech Stack

- Vanilla JavaScript (ES6 modules), HTML, CSS
- Chrome Extensions API (Manifest V3) — storage, side panel, content scripts
- Google Gemini API (`gemini-2.5-flash`) for AI hints

## Project Structure

```
manifest.json      Chrome extension manifest
background.js      Service worker — tab monitoring, message routing
content.js         Content script — detects wrong answers on PrairieLearn
sidepanel.html/js  Side panel UI — reflection, AI hints, save entry
dashboard.html/js  Dashboard — browse and review past mistakes
popup.js           Gemini API integration
config.js          API key configuration (not committed)
```

## Notes

- Only triggers on practice-type assessments (PQ*, PA*, P* prefixed)
- `config.js` is excluded from version control — never commit your API key
- All journal data is stored locally via `chrome.storage.local` and never sent anywhere except the Gemini API for hint generation
