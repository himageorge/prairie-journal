import { CONFIG } from './config.js';

const SYSTEM_PROMPT = `You are a Socratic teaching assistant for a university STEM course.
Your job is to help students understand their mistakes WITHOUT giving away the answer.
Ask guiding questions that lead the student to discover the correct reasoning themselves.

FORMATTING RULES:
- You may use basic markdown: bold (**text**), numbered lists, bullet lists.
- Do NOT use LaTeX or dollar signs for math. Write math in plain English (e.g., "N of h equals 1 plus N of h minus 1").
- Keep your response concise and conversational.
- If a screenshot of the question is provided, use it to better understand the problem context.`;

/**
 * Fetch Socratic Explanation using the Claude API.
 */
export async function getSocraticExplanation(questionData) {
    const textBlock = {
        type: 'text',
        text: `Course: ${questionData.course}
Topic: ${questionData.questionTitle}
Question: ${questionData.questionText}
Student Answer: ${questionData.myAnswer}
Correct Answer: ${questionData.correctAnswer}
Student Logic: "${questionData.myReasoning}"

Identify the gaps in the student's understanding and explain how to find the correct answer using the Socratic method.`
    };

    // Build content array — prepend screenshot image block if provided
    let content;
    if (questionData.screenshot) {
        const base64Data = questionData.screenshot.split(',')[1];
        const mediaType = questionData.screenshot.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png';
        content = [
            {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64Data }
            },
            textBlock
        ];
    } else {
        content = textBlock.text;
    }

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CONFIG.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-opus-4-6',
                max_tokens: 1024,
                system: SYSTEM_PROMPT,
                messages: [{ role: 'user', content }]
            })
        });

        const data = await response.json();
        console.log("Claude API Full Response:", data);
        const feedback = data.content?.[0]?.text;
        return feedback || "The TA is pondering... try rephrasing your reflection.";
    } catch (error) {
        console.error("AI Error:", error);
        return "The brain is offline. Check your API key in config.js.";
    }
}

/**
 * Chat Logic — maintains conversation history for follow-up questions.
 * history format: [{role: "user", content: "..."}, {role: "assistant", content: "..."}]
 */
export async function sendChatMessage(history, newUserMessage) {
    const response = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': CONFIG.CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: 'claude-opus-4-6',
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages: [...history, { role: 'user', content: newUserMessage }]
        })
    });
    const data = await response.json();
    return data.content[0].text;
}
