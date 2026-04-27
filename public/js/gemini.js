// public/js/gemini.js

const GEMINI_API_KEY = "AIzaSyDYKEL1lX4CGpQjHKscz2s7y2HO5z02xN0";

// 🛡️ BULLETPROOF FALLBACK ALGORITHM
// If Google's servers go down during your demo, this runs instantly.
function getFallbackScore(volunteerSkills, taskSkills) {
    if (!taskSkills || taskSkills.length === 0) {
        return { score: 100, reason: "(Fallback Mode) Any skill works here." };
    }
    
    let matches = 0;
    taskSkills.forEach(taskSkill => {
        if (volunteerSkills.includes(taskSkill.toLowerCase().trim())) {
            matches++;
        }
    });
    
    const percentage = Math.round((matches / taskSkills.length) * 100);
    
    let reason = "(Fallback Mode) Limited skill overlap.";
    if (percentage === 100) reason = "(Fallback Mode) Perfect skill match!";
    else if (percentage >= 50) reason = "(Fallback Mode) Good partial skill match.";

    return { score: percentage, reason: reason };
}

export async function getMatchScore(volunteerSkills, taskSkills) {
    if (!GEMINI_API_KEY) {
        return { score: 0, reason: "⚠️ AI Key missing." };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const promptText = `
        You are an AI that matches NGO volunteers to community tasks.
        The volunteer has these skills: ${volunteerSkills.join(", ")}.
        The task requires these skills: ${taskSkills.join(", ")}.
        
        Evaluate the match. Provide a match score from 0 to 100, and a short one-line reason (maximum 12 words) explaining why it's a good or bad fit.
        
        Return STRICTLY valid JSON in this exact format:
        {"score": 85, "reason": "Strong match: Volunteer has teaching experience."}
    `;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { 
                    responseMimeType: "application/json",
                    temperature: 0.2
                }
            })
        });

        // If Google is overloaded (503) or throws any error, catch it!
        if (!response.ok) {
            const errorDetails = await response.json();
            console.warn("⚠️ AI SERVER OVERLOADED. Triggering local fallback.", errorDetails);
            return getFallbackScore(volunteerSkills, taskSkills);
        }

        const data = await response.json();
        const resultText = data.candidates[0].content.parts[0].text;
        return JSON.parse(resultText);

    } catch (error) {
        console.warn("⚠️ NETWORK/API FAILURE. Triggering local fallback.", error);
        return getFallbackScore(volunteerSkills, taskSkills);
    }
}