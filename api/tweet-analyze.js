export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { comments, tweetUrl } = req.body;
  if (!comments || !Array.isArray(comments)) {
    return res.status(400).json({ error: 'Faltan comentarios para analizar' });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurado' });

  const commentTexts = comments
    .slice(0, 80) // limit to avoid token overflow
    .map((c, i) => `[${i + 1}] @${c.author} (${c.followers} seguidores, ${c.likes} likes): "${c.text}"`)
    .join('\n');

  const prompt = `Analizá los siguientes comentarios de un tweet y devolvé SOLO un JSON válido sin backticks ni texto adicional.

Tweet URL: ${tweetUrl}
Total de comentarios: ${comments.length}

Comentarios:
${commentTexts}

Devolvé exactamente este JSON (sin texto extra, sin backticks):
{
  "summary": "resumen ejecutivo del impacto del tweet en 2-3 oraciones",
  "totalComments": ${comments.length},
  "sentiment": {
    "positive": 0,
    "negative": 0,
    "neutral": 0
  },
  "emotions": [
    {"name": "nombre de la emoción", "percentage": 0, "description": "descripción breve"}
  ],
  "topics": [
    {"topic": "tema principal", "count": 0, "sentiment": "positive|negative|neutral"}
  ],
  "influentialUsers": [
    {"username": "usuario", "followers": 0, "comment": "su comentario", "sentiment": "positive|negative|neutral"}
  ],
  "timeline": [
    {"period": "descripción del período", "activity": "descripción de la actividad"}
  ],
  "impactScore": 0,
  "impactLabel": "Alto|Medio|Bajo",
  "keyInsights": ["insight 1", "insight 2", "insight 3"],
  "recommendation": "recomendación accionable basada en el análisis"
}

Reglas:
- sentiment: los 3 valores deben sumar exactamente 100 (son porcentajes)
- emotions: incluir entre 3 y 5 emociones predominantes, los percentages deben sumar 100
- topics: los 5 temas más mencionados con cantidad estimada de menciones
- influentialUsers: los 3 usuarios con más seguidores o más likes en su comentario
- timeline: descripción cualitativa de cómo evolucionó la conversación (si hay fechas disponibles)
- impactScore: número del 1 al 100 que refleja el impacto general
- keyInsights: exactamente 3 insights accionables
- todos los textos en español`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err?.error?.message || `Anthropic error ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.map(b => b.text || '').join('') || '';

    // Robust JSON extraction
    let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1) clean = clean.slice(start, end + 1);

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (_) {
      const fixed = clean.replace(/,\s*([}\]])/g, '$1');
      parsed = JSON.parse(fixed);
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Analyze error:', err);
    return res.status(500).json({ error: err.message });
  }
}
