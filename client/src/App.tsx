import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import DashboardLayout from "./components/DashboardLayout";
import { ThemeProvider } from "./contexts/ThemeContext";
import Chat from "./pages/Chat";
import Tasks from "./pages/Tasks";
import Memory from "./pages/Memory";
import Tools from "./pages/Tools";
import Finance from "./pages/Finance";
import Scheduler from "./pages/Scheduler";
import Settings from "./pages/Settings";
import ManusImport from "./pages/ManusImport";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Chat} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/memory" component={Memory} />
        <Route path="/tools" component={Tools} />
        <Route path="/finance" component={Finance} />
        <Route path="/scheduler" component={Scheduler} />
        <Route path="/settings" component={Settings} />
        <Route path="/import" component={ManusImport} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
