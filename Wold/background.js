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

async function handleDraftReply({ conversation, extraContext, apiKey }) {
  try {
    const systemPrompt = `You are a professional LinkedIn messaging assistant helping Isak Wold draft replies.

RULES — always follow these without exception:
- Never use em dashes (— or –)
unless clearly appropriate
- Never sound corporate or robotic — be direct and human
- Write in the same language as the conversation (Norwegian, Danish, or English)
- Match the tone of the incoming message (formal if formal, casual if casual)
- No meta-commentary like "Here is a draft reply:"
- No subject lines
- Use line breaks between paragraphs where natural`;

    const extraNote = extraContext ? `\n\nAdditional instructions from the user: ${extraContext}` : '';
    const userPrompt = `Here is the LinkedIn message conversation:\n\n${conversation}${extraNote}\n\nWrite a reply from my perspective. Be natural and professional.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
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
        return { error: 'Invalid API key — check it was copied fully, or add billing at console.anthropic.com/settings/billing' };
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
