/**
 * Project Management Plugin — ClickUp
 */
let config = {};

module.exports = {
  name: 'project-management',
  version: '1.0.0',
  description: 'Project management via ClickUp: tasks, milestones, deadlines, team tracking',
  requiredKeys: ['CLICKUP_API_KEY'],
  commands: ['/tasks', '/milestone', '/projects'],
  tools: [
    {
      type: 'function', function: {
        name: 'clickup_list_tasks',
        description: 'List tasks from ClickUp workspace',
        parameters: { type: 'object', properties: {
          listId: { type: 'string', description: 'ClickUp list ID' },
          status: { type: 'string', description: 'Filter by status (open, in progress, done)' }
        }, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'clickup_create_task',
        description: 'Create a new task in ClickUp',
        parameters: { type: 'object', properties: {
          name: { type: 'string', description: 'Task name' },
          description: { type: 'string', description: 'Task description' },
          listId: { type: 'string', description: 'ClickUp list ID' },
          priority: { type: 'number', description: '1=urgent, 2=high, 3=normal, 4=low' },
          dueDate: { type: 'string', description: 'Due date (ISO 8601)' }
        }, required: ['name'] }
      }
    },
    {
      type: 'function', function: {
        name: 'clickup_update_task',
        description: 'Update a ClickUp task status or details',
        parameters: { type: 'object', properties: {
          taskId: { type: 'string', description: 'Task ID' },
          status: { type: 'string', description: 'New status' },
          name: { type: 'string', description: 'Updated name' }
        }, required: ['taskId'] }
      }
    }
  ],

  init(deps) { config = deps.config; },

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'clickup_list_tasks': return await listTasks(args);
      case 'clickup_create_task': return await createTask(args);
      case 'clickup_update_task': return await updateTask(args);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
};

async function clickupRequest(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Authorization': config.CLICKUP_API_KEY, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000)
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://api.clickup.com/api/v2${endpoint}`, opts);
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${await res.text()}`);
  return res.json();
}

async function listTasks(args) {
  try {
    const listId = args.listId || config.CLICKUP_WORKSPACE_ID;
    if (!listId) return { success: false, error: 'No list ID provided or configured' };
    const data = await clickupRequest(`/list/${listId}/task?include_closed=true`);
    return {
      success: true,
      tasks: (data.tasks || []).map(t => ({
        id: t.id, name: t.name, status: t.status?.status,
        priority: t.priority?.priority, dueDate: t.due_date,
        assignees: t.assignees?.map(a => a.username)
      }))
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function createTask(args) {
  try {
    const listId = args.listId || config.CLICKUP_WORKSPACE_ID;
    if (!listId) return { success: false, error: 'No list ID' };
    const body = { name: args.name, description: args.description || '' };
    if (args.priority) body.priority = args.priority;
    if (args.dueDate) body.due_date = new Date(args.dueDate).getTime();
    const data = await clickupRequest(`/list/${listId}/task`, 'POST', body);
    return { success: true, taskId: data.id, url: data.url };
  } catch (e) { return { success: false, error: e.message }; }
}

async function updateTask(args) {
  try {
    const body = {};
    if (args.status) body.status = args.status;
    if (args.name) body.name = args.name;
    await clickupRequest(`/task/${args.taskId}`, 'PUT', body);
    return { success: true, message: `Task ${args.taskId} updated` };
  } catch (e) { return { success: false, error: e.message }; }
}
