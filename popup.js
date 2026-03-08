import { CONFIG } from './config.js';

/**
 * PERSON 3: Fetch Socratic Explanation
 * Triggered when Person 1's "Explain" button is clicked.
 */
export async function getSocraticExplanation(questionData) {
    const prompt = `
        You are a Socratic TA. 
        Course: ${questionData.course}
        Topic: ${questionData.questionTitle}
        Question: ${questionData.questionText}
        Student Answer: ${questionData.myAnswer}
        Correct Answer: ${questionData.correctAnswer}
        Student Logic: "${questionData.myReasoning}"

        Task: Do NOT give the answer. Identify the logical gap. 
        Ask one leading question. Keep it under 100 words.
    `;

    try {
        const response = await fetch(`${CONFIG.API_URL}?key=${CONFIG.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        
        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error("AI Error:", error);
        return "The brain is offline. Check your API key in config.js.";
    }
}


/**
 * PERSON 3: Chat Logic
 * Maintains a small conversation history for follow-up questions.
 */
export async function sendChatMessage(history, newUserMessage) {
    // history format: [{role: "user", parts: [{text: "..."}]}, {role: "model", parts: [...]}]
    const response = await fetch(`${CONFIG.API_URL}?key=${CONFIG.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [...history, { role: "user", parts: [{ text: newUserMessage }] }] })
    });
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}
import { CONFIG } from './config.js';

/**
 * PERSON 3: Fetch Socratic Explanation
 * Triggered when Person 1's "Explain" button is clicked.
 */
export async function getSocraticExplanation(questionData) {
    const prompt = `
        You are a Socratic TA. 
        Course: ${questionData.course}
        Topic: ${questionData.questionTitle}
        Question: ${questionData.questionText}
        Student Answer: ${questionData.myAnswer}
        Correct Answer: ${questionData.correctAnswer}
        Student Logic: "${questionData.myReasoning}"

        Task: Do NOT give the answer. Identify the logical gap. 
        Ask one leading question. Keep it under 100 words.
    `;

    try {
        const response = await fetch(`${CONFIG.API_URL}?key=${CONFIG.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        
        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error("AI Error:", error);
        return "The brain is offline. Check your API key in config.js.";
    }
}

/**
 * PERSON 3: Chat Logic
 * Maintains a small conversation history for follow-up questions.
 */
export async function sendChatMessage(history, newUserMessage) {
    // history format: [{role: "user", parts: [{text: "..."}]}, {role: "model", parts: [...]}]
    const response = await fetch(`${CONFIG.API_URL}?key=${CONFIG.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [...history, { role: "user", parts: [{ text: newUserMessage }] }] })
    });
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}
