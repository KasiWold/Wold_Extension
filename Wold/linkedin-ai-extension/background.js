// LinkedIn AI Reply - Background Service Worker
// Handles Anthropic API calls (avoids CORS issues from content scripts)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DRAFT_REPLY') {
    handleDraftReply(message.payload).then(sendResponse);
    return true; // Keep message channel open for async response
  }

  if (message.type === 'OPEN_POPUP') {
    chrome.action.openPopup?.();
    return false;
  }
});

async function handleDraftReply({ conversation, apiKey }) {
  try {
    const systemPrompt = `You are a professional LinkedIn messaging assistant. 
Your job is to draft a concise, natural reply to a LinkedIn message thread.

Guidelines:
- Match the tone of the incoming message (formal if formal, casual if casual)
- Keep replies professional and warm — appropriate for networking
- Be direct and human — not corporate or robotic
- Do NOT use phrases like "I hope this message finds you well" or "Please don't hesitate"
- Keep it short: 2–4 sentences unless a longer reply is clearly warranted
- Never use em dashes (—)
- Write only the reply text itself, no subject line, no sign-off like "Best regards" unless the conversation warrants it
- Do not include any meta-commentary like "Here is a draft reply:"`;

    const userPrompt = `Here is the LinkedIn message conversation so far:\n\n${conversation}\n\nWrite a reply from my perspective (the last responder, or me if the conversation is new to me). Be natural and professional.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) {
        return { error: 'Invalid API key. Check your settings.' };
      }
      return { error: errorData.error?.message || `API error ${response.status}` };
    }

    const data = await response.json();
    const draft = data.content?.[0]?.text?.trim();

    if (!draft) {
      return { error: 'No reply generated. Try again.' };
    }

    return { draft };

  } catch (err) {
    console.error('[LinkedIn AI Reply] Background error:', err);
    return { error: 'Network error. Check your connection.' };
  }
}
