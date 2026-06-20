import { CONFIG } from './config.js';

const SYSTEM_PROMPT = `Use the question, the correct answer, the reflection provided by the user and provide an
explanation 

FORMATTING RULES:
- You may use basic markdown: bold (**text**), numbered lists, bullet lists.
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

Identify the gaps in the student's understanding and explain how to find the correct answer using the Socratic method 
and limit explanation to maximum 400 words.`
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
        return "The brain is offline. Check your API key ";
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
