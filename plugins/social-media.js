/**
 * Social Media Plugin — Instagram, TikTok, Facebook Pages
 */
let config = {};

module.exports = {
  name: 'social-media',
  version: '1.0.0',
  description: 'Multi-platform social media: Instagram, TikTok, Facebook posting and analytics',
  requiredKeys: [],  // Works with any subset of tokens
  commands: ['/post', '/social_stats'],
  tools: [
    {
      type: 'function', function: {
        name: 'instagram_post',
        description: 'Post an image to Instagram Business account',
        parameters: { type: 'object', properties: {
          imageUrl: { type: 'string', description: 'Public URL of image to post' },
          caption: { type: 'string', description: 'Post caption with hashtags' }
        }, required: ['imageUrl', 'caption'] }
      }
    },
    {
      type: 'function', function: {
        name: 'instagram_insights',
        description: 'Get Instagram account insights and recent post performance',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'facebook_post',
        description: 'Post to a Facebook Page (Irish Craftsman or Building Shultz)',
        parameters: { type: 'object', properties: {
          page: { type: 'string', enum: ['irish_craftsman', 'building_shultz'], description: 'Which page to post to' },
          message: { type: 'string', description: 'Post text' },
          link: { type: 'string', description: 'Optional link to attach' }
        }, required: ['page', 'message'] }
      }
    },
    {
      type: 'function', function: {
        name: 'tiktok_upload',
        description: 'Upload a video to TikTok (requires video URL)',
        parameters: { type: 'object', properties: {
          videoUrl: { type: 'string', description: 'Public URL of video file' },
          caption: { type: 'string', description: 'Video caption' }
        }, required: ['videoUrl', 'caption'] }
      }
    },
    {
      type: 'function', function: {
        name: 'social_analytics',
        description: 'Get analytics across all connected social platforms',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    }
  ],

  init(deps) { config = deps.config; },

  get _active() {
    return !!(config.INSTAGRAM_ACCESS_TOKEN || config.META_PAGE_ACCESS_TOKEN || config.TIKTOK_ACCESS_TOKEN);
  },

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'instagram_post': return await instagramPost(args);
      case 'instagram_insights': return await instagramInsights();
      case 'facebook_post': return await facebookPost(args);
      case 'tiktok_upload': return await tiktokUpload(args);
      case 'social_analytics': return await socialAnalytics();
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
};

// ── INSTAGRAM ──────────────────────────────────────────────────────────────
async function instagramPost(args) {
  if (!config.INSTAGRAM_ACCESS_TOKEN) return { success: false, error: 'Instagram access token not configured' };
  try {
    const igId = config.INSTAGRAM_BUSINESS_ID;
    // Create media container
    const container = await fetch(`https://graph.facebook.com/v18.0/${igId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: args.imageUrl, caption: args.caption, access_token: config.INSTAGRAM_ACCESS_TOKEN })
    }).then(r => r.json());
    if (container.error) throw new Error(container.error.message);
    // Publish
    const publish = await fetch(`https://graph.facebook.com/v18.0/${igId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: container.id, access_token: config.INSTAGRAM_ACCESS_TOKEN })
    }).then(r => r.json());
    if (publish.error) throw new Error(publish.error.message);
    return { success: true, postId: publish.id };
  } catch (e) { return { success: false, error: e.message }; }
}

async function instagramInsights() {
  if (!config.INSTAGRAM_ACCESS_TOKEN) return { success: false, error: 'Instagram not configured' };
  try {
    const igId = config.INSTAGRAM_BUSINESS_ID;
    const [profile, media] = await Promise.all([
      fetch(`https://graph.facebook.com/v18.0/${igId}?fields=followers_count,media_count,username&access_token=${config.INSTAGRAM_ACCESS_TOKEN}`).then(r => r.json()),
      fetch(`https://graph.facebook.com/v18.0/${igId}/media?fields=id,caption,like_count,comments_count,timestamp&limit=10&access_token=${config.INSTAGRAM_ACCESS_TOKEN}`).then(r => r.json())
    ]);
    return {
      success: true, source: 'Instagram Graph API (REAL DATA)',
      profile: { username: profile.username, followers: profile.followers_count, posts: profile.media_count },
      recentPosts: (media.data || []).map(p => ({ id: p.id, likes: p.like_count, comments: p.comments_count, date: p.timestamp, caption: p.caption?.slice(0, 50) }))
    };
  } catch (e) { return { success: false, error: e.message }; }
}

// ── FACEBOOK ───────────────────────────────────────────────────────────────
async function facebookPost(args) {
  if (!config.META_PAGE_ACCESS_TOKEN) return { success: false, error: 'Facebook Page token not configured' };
  const pageId = args.page === 'irish_craftsman' ? config.META_PAGE_ID_IRISH_CRAFTSMAN : config.META_PAGE_ID_BUILDING_SHULTZ;
  if (!pageId) return { success: false, error: `Page ID not configured for ${args.page}` };
  try {
    const body = { message: args.message, access_token: config.META_PAGE_ACCESS_TOKEN };
    if (args.link) body.link = args.link;
    const res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/feed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json());
    if (res.error) throw new Error(res.error.message);
    return { success: true, postId: res.id };
  } catch (e) { return { success: false, error: e.message }; }
}

// ── TIKTOK ─────────────────────────────────────────────────────────────────
async function tiktokUpload(args) {
  if (!config.TIKTOK_ACCESS_TOKEN) return { success: false, error: 'TikTok access token not configured' };
  try {
    // TikTok Content Posting API
    const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.TIKTOK_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_info: { title: args.caption, privacy_level: 'PUBLIC_TO_EVERYONE' },
        source_info: { source: 'PULL_FROM_URL', video_url: args.videoUrl }
      })
    }).then(r => r.json());
    if (initRes.error?.code) throw new Error(initRes.error.message);
    return { success: true, publishId: initRes.data?.publish_id };
  } catch (e) { return { success: false, error: e.message }; }
}

// ── CROSS-PLATFORM ANALYTICS ───────────────────────────────────────────────
async function socialAnalytics() {
  const results = { platforms: {} };
  
  if (config.INSTAGRAM_ACCESS_TOKEN) {
    const ig = await instagramInsights();
    if (ig.success) results.platforms.instagram = ig.profile;
  }
  
  if (config.META_PAGE_ACCESS_TOKEN && config.META_PAGE_ID_BUILDING_SHULTZ) {
    try {
      const fb = await fetch(`https://graph.facebook.com/v18.0/${config.META_PAGE_ID_BUILDING_SHULTZ}?fields=fan_count,name&access_token=${config.META_PAGE_ACCESS_TOKEN}`).then(r => r.json());
      results.platforms.facebook_building_shultz = { name: fb.name, followers: fb.fan_count };
    } catch {}
  }
  
  results.success = true;
  results.source = 'Platform APIs (REAL DATA)';
  return results;
}
