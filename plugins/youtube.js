/**
 * YouTube Plugin — Real Analytics, SEO, Upload Management via YouTube Data API v3
 */
let config = {};
const BASE_URL = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS_URL = 'https://youtubeanalytics.googleapis.com/v2/reports';

module.exports = {
  name: 'youtube',
  version: '1.0.0',
  description: 'YouTube Data API: real channel analytics, video stats, SEO optimization, upload management',
  requiredKeys: ['YOUTUBE_API_KEY'],
  commands: ['/yt_stats', '/yt_videos', '/yt_analytics', '/yt_seo'],
  tools: [
    {
      type: 'function',
      function: {
        name: 'youtube_channel_stats',
        description: 'Get REAL YouTube channel statistics (subscribers, views, videos). Uses YouTube Data API — never fabricates data.',
        parameters: {
          type: 'object',
          properties: {
            channelId: { type: 'string', description: 'YouTube channel ID (optional, uses configured default)' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'youtube_recent_videos',
        description: 'Get recent video uploads with real view counts and engagement metrics',
        parameters: {
          type: 'object',
          properties: {
            maxResults: { type: 'number', description: 'Number of videos (max 50)' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'youtube_video_analytics',
        description: 'Get detailed analytics for a specific video',
        parameters: {
          type: 'object',
          properties: {
            videoId: { type: 'string', description: 'YouTube video ID' }
          },
          required: ['videoId']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'youtube_search_keywords',
        description: 'Search YouTube for keyword research and competition analysis',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query for keyword research' },
            maxResults: { type: 'number', description: 'Number of results' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'youtube_update_video',
        description: 'Update video title, description, or tags for SEO optimization',
        parameters: {
          type: 'object',
          properties: {
            videoId: { type: 'string', description: 'Video ID to update' },
            title: { type: 'string', description: 'New title (optional)' },
            description: { type: 'string', description: 'New description (optional)' },
            tags: { type: 'string', description: 'Comma-separated tags (optional)' }
          },
          required: ['videoId']
        }
      }
    }
  ],

  init(deps) { config = deps.config; },

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'youtube_channel_stats': return await getChannelStats(args.channelId);
      case 'youtube_recent_videos': return await getRecentVideos(args.maxResults || 10);
      case 'youtube_video_analytics': return await getVideoAnalytics(args.videoId);
      case 'youtube_search_keywords': return await searchKeywords(args.query, args.maxResults || 10);
      case 'youtube_update_video': return await updateVideo(args);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
};

async function ytRequest(endpoint, params = {}) {
  params.key = config.YOUTUBE_API_KEY;
  const url = `${BASE_URL}${endpoint}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `YouTube API ${res.status}`);
  }
  return res.json();
}

async function getChannelStats(channelId = null) {
  try {
    const id = channelId || config.YOUTUBE_CHANNEL_ID;
    if (!id) return { success: false, error: 'No channel ID configured. Set YOUTUBE_CHANNEL_ID in .env' };
    
    const data = await ytRequest('/channels', { part: 'statistics,snippet,contentDetails', id });
    if (!data.items || data.items.length === 0) return { success: false, error: 'Channel not found' };
    
    const ch = data.items[0];
    return {
      success: true,
      source: 'YouTube Data API v3 (REAL DATA)',
      channel: {
        title: ch.snippet.title,
        description: ch.snippet.description?.slice(0, 200),
        customUrl: ch.snippet.customUrl,
        publishedAt: ch.snippet.publishedAt,
        subscribers: parseInt(ch.statistics.subscriberCount),
        totalViews: parseInt(ch.statistics.viewCount),
        videoCount: parseInt(ch.statistics.videoCount),
        uploadsPlaylist: ch.contentDetails?.relatedPlaylists?.uploads
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getRecentVideos(maxResults = 10) {
  try {
    const channelId = config.YOUTUBE_CHANNEL_ID;
    if (!channelId) return { success: false, error: 'No channel ID configured' };
    
    // Get upload playlist
    const ch = await ytRequest('/channels', { part: 'contentDetails', id: channelId });
    const uploadsId = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) return { success: false, error: 'Could not find uploads playlist' };
    
    // Get recent videos
    const playlist = await ytRequest('/playlistItems', { part: 'snippet', playlistId: uploadsId, maxResults });
    const videoIds = playlist.items.map(i => i.snippet.resourceId.videoId).join(',');
    
    // Get stats for each video
    const stats = await ytRequest('/videos', { part: 'statistics,snippet,contentDetails', id: videoIds });
    
    return {
      success: true,
      source: 'YouTube Data API v3 (REAL DATA)',
      videos: stats.items.map(v => ({
        id: v.id,
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        views: parseInt(v.statistics.viewCount),
        likes: parseInt(v.statistics.likeCount || 0),
        comments: parseInt(v.statistics.commentCount || 0),
        duration: v.contentDetails.duration,
        tags: v.snippet.tags?.slice(0, 10) || []
      }))
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getVideoAnalytics(videoId) {
  try {
    const data = await ytRequest('/videos', { part: 'statistics,snippet,contentDetails,topicDetails', id: videoId });
    if (!data.items || data.items.length === 0) return { success: false, error: 'Video not found' };
    
    const v = data.items[0];
    return {
      success: true,
      source: 'YouTube Data API v3 (REAL DATA)',
      video: {
        title: v.snippet.title,
        description: v.snippet.description?.slice(0, 500),
        publishedAt: v.snippet.publishedAt,
        channelTitle: v.snippet.channelTitle,
        tags: v.snippet.tags || [],
        views: parseInt(v.statistics.viewCount),
        likes: parseInt(v.statistics.likeCount || 0),
        comments: parseInt(v.statistics.commentCount || 0),
        duration: v.contentDetails.duration,
        definition: v.contentDetails.definition,
        topics: v.topicDetails?.topicCategories || []
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function searchKeywords(query, maxResults = 10) {
  try {
    const data = await ytRequest('/search', {
      part: 'snippet', q: query, type: 'video', maxResults, order: 'relevance'
    });
    
    // Get stats for found videos
    const videoIds = data.items.map(i => i.id.videoId).join(',');
    const stats = await ytRequest('/videos', { part: 'statistics', id: videoIds });
    const statsMap = {};
    stats.items.forEach(v => { statsMap[v.id] = v.statistics; });
    
    return {
      success: true,
      source: 'YouTube Data API v3 (REAL DATA)',
      query,
      results: data.items.map(i => ({
        videoId: i.id.videoId,
        title: i.snippet.title,
        channelTitle: i.snippet.channelTitle,
        publishedAt: i.snippet.publishedAt,
        views: parseInt(statsMap[i.id.videoId]?.viewCount || 0),
        description: i.snippet.description?.slice(0, 150)
      }))
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function updateVideo(args) {
  // Requires OAuth token
  if (!config.YOUTUBE_OAUTH_REFRESH_TOKEN) {
    return { success: false, error: 'Video updates require OAuth. Set YOUTUBE_OAUTH_REFRESH_TOKEN in .env' };
  }
  
  try {
    // Get access token from refresh token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.YOUTUBE_OAUTH_CLIENT_ID,
        client_secret: config.YOUTUBE_OAUTH_CLIENT_SECRET,
        refresh_token: config.YOUTUBE_OAUTH_REFRESH_TOKEN,
        grant_type: 'refresh_token'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return { success: false, error: 'OAuth token refresh failed' };
    
    // Get current video data
    const current = await ytRequest('/videos', { part: 'snippet', id: args.videoId });
    if (!current.items?.length) return { success: false, error: 'Video not found' };
    
    const snippet = current.items[0].snippet;
    if (args.title) snippet.title = args.title;
    if (args.description) snippet.description = args.description;
    if (args.tags) snippet.tags = args.tags.split(',').map(t => t.trim());
    
    const updateRes = await fetch(`${BASE_URL}/videos?part=snippet`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: args.videoId, snippet })
    });
    
    if (!updateRes.ok) throw new Error(`Update failed: ${updateRes.status}`);
    return { success: true, message: `Video ${args.videoId} updated` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
