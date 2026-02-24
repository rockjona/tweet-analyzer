export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tweetUrl } = req.body;
  if (!tweetUrl) return res.status(400).json({ error: 'Falta el parámetro tweetUrl' });

  const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
  if (!APIFY_TOKEN) return res.status(500).json({ error: 'APIFY_API_TOKEN no configurado' });

  try {
    // Start the Apify actor run
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/apidojo~tweet-scraper/runs?token=${APIFY_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: [tweetUrl],
          maxItems: 100,
          addUserInfo: true,
        }),
      }
    );

    if (!runRes.ok) {
      const err = await runRes.json();
      throw new Error(err?.error?.message || `Apify error ${runRes.status}`);
    }

    const run = await runRes.json();
    const runId = run.data?.id;
    if (!runId) throw new Error('No se obtuvo un run ID de Apify');

    // Poll until finished (max 25s due to Vercel timeout)
    let status = 'RUNNING';
    let attempts = 0;
    while (status === 'RUNNING' && attempts < 20) {
      await new Promise(r => setTimeout(r, 2000));
      const statusRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`
      );
      const statusData = await statusRes.json();
      status = statusData.data?.status;
      attempts++;
    }

    if (status !== 'SUCCEEDED') {
      throw new Error(`El scraper terminó con estado: ${status}. Intentá de nuevo.`);
    }

    // Get the dataset results
    const dataRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}&limit=100`
    );
    const items = await dataRes.json();

    // Filter only replies/comments (not the original tweet)
    const comments = items
      .filter(item => item.text && item.id)
      .map(item => ({
        id: item.id,
        text: item.text,
        author: item.author?.userName || item.user?.screen_name || 'unknown',
        authorName: item.author?.name || item.user?.name || 'unknown',
        followers: item.author?.followers || item.user?.followers_count || 0,
        likes: item.likeCount || item.favorite_count || 0,
        date: item.createdAt || item.created_at || null,
        isReply: item.isReply || false,
      }));

    return res.status(200).json({
      tweetUrl,
      totalComments: comments.length,
      comments,
    });

  } catch (err) {
    console.error('Scrape error:', err);
    return res.status(500).json({ error: err.message });
  }
}
