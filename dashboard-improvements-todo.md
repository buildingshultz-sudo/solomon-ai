# Solomon Dashboard Improvements To-Do List

Based on an analysis of the current `dashboard.html` and `dashboard.js` implementation, here is a comprehensive to-do list to improve the Solomon monitoring dashboard, focusing on user experience, interactivity, and mobile responsiveness.

## 1. Direct Messaging Capabilities
The most critical feature requested by the owner is the ability to send instructions directly to Solomon from the dashboard.

- **Add Message Input UI**: Create a sticky or floating message input bar at the bottom of the dashboard (similar to chat interfaces).
- **Implement Backend Endpoint**: Add a `POST /api/message` endpoint in `dashboard.js` to receive messages from the web interface.
- **Database Integration**: The backend endpoint should insert the received message directly into the `nathan_inbox` table or trigger the bot's internal message handling function.
- **Real-time Feedback**: Update the activity feed instantly when a message is sent via the dashboard, showing it as an outbound message.

## 2. User Interface & Navigation
The current dashboard is a single-page view with stacked sections. It can be reorganized for better readability.

- **Tabbed Navigation**: Implement tabs or a sidebar (collapsible on mobile) to separate "Live Monitoring", "Task Queue", "Tool Usage", and "System Logs/Errors". This prevents endless scrolling.
- **Visual Hierarchy Refinement**: 
  - Make the "Quick Stats" cards more prominent with icons and better typography.
  - Differentiate the "Activity Feed" from static lists by giving it a distinct container style (e.g., a terminal-like dark theme or a chat-like bubble theme).
- **Status Indicators**: Improve the main status indicator (IDLE/THINKING/WORKING) with subtle pulsing animations when active to make the system state immediately obvious.

## 3. Mobile UX Enhancements
The dashboard needs to be fully responsive and optimized for touch interactions.

- **Responsive Grid**: Ensure the stats grid changes from 4-columns on desktop to 2-columns or 1-column on mobile devices.
- **Swipe Gestures**: If implementing tabs, allow swiping left/right to switch between different views (Monitoring vs. Tasks).
- **Pull-to-Refresh**: Implement a pull-to-refresh mechanism for mobile users to manually sync state if WebSocket connection drops.
- **Touch Targets**: Increase the padding and size of buttons (like the Login button and future Quick Action buttons) to meet mobile accessibility standards (minimum 44x44px).

## 4. Notifications & Alerts
Users should be aware of important events even if they aren't actively staring at the feed.

- **Browser Notifications**: Implement the Web Notifications API to push alerts for critical errors or task completions when the dashboard is in the background.
- **Unread Badges**: Add notification badges to tabs (e.g., a red dot on the "Errors" tab if new errors occur, or a badge on "Task Queue" when tasks are pending).
- **Toast Notifications**: Use non-intrusive toast popups in the corner of the screen for successful actions (e.g., "Message sent successfully", "Task completed").

## 5. Quick Actions & Control
Currently, the dashboard is read-only. Adding control features will make it a true command center.

- **Action Bar**: Add a row of quick action buttons near the top or alongside relevant sections.
- **Specific Actions to Implement**:
  - **Clear Errors**: A button to acknowledge and clear the recent errors list.
  - **Restart Bot**: A button to safely restart the Solomon PM2 process (requires adding an endpoint in `dashboard.js` that executes a shell command or signals the bot).
  - **Pause/Resume Tasks**: Buttons on individual pending tasks in the queue to pause or cancel them.
- **Confirmation Modals**: Ensure destructive actions (like restarting or canceling tasks) have a confirmation dialog to prevent accidental clicks.

## 6. Code & Performance Improvements
Under-the-hood improvements to support the new features.

- **WebSocket Reconnection Logic**: Enhance the frontend WebSocket code to automatically attempt reconnection with exponential backoff if the connection is lost.
- **Session Persistence**: Improve the simple in-memory token system in `dashboard.js` to survive dashboard restarts, perhaps by storing active sessions in the SQLite database or a local JSON file.
- **Data Pagination**: As activity grows, implement pagination or infinite scrolling for the activity and error feeds rather than just a hardcoded limit.
