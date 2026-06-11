/**
 * Application entry point for Growth Chart download analytics dashboard.
 *
 * Configures routing and initializes app with skateboard-ui framework.
 * Single-route app — the dashboard is the only view.
 *
 * @see {@link https://github.com/stevederico/skateboard|Skateboard Docs}
 */
import './assets/styles.css';
import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router';
import { createSkateboardApp } from '@stevederico/skateboard-ui/App';
import type { AppRoute } from '@stevederico/skateboard-ui/App';
import { Spinner } from '@stevederico/skateboard-ui/shadcn/ui/spinner';
import Layout from '@stevederico/skateboard-ui/Layout';
import CommandMenu from './components/CommandMenu';
import constants from './constants.json';
const HomeView = lazy(() => import('./components/HomeView'));
const OverviewView = lazy(() => import('./components/OverviewView'));
import SettingsView from './components/SettingsView';

/**
 * App layout with global command menu overlay.
 *
 * @returns Layout with command menu
 */
function AppLayout() {
  return (
    <>
      <CommandMenu />
      <Layout />
    </>
  );
}

/**
 * Route configuration — single dashboard route.
 */
const appRoutes: AppRoute[] = [
  {
    path: 'home',
    element: (
      <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Spinner /></div>}>
        <HomeView />
      </Suspense>
    ),
  },
  {
    path: 'overview',
    element: (
      <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Spinner /></div>}>
        <OverviewView />
      </Suspense>
    ),
  },
];

/**
 * Initialize and mount the Growth Chart app.
 */
createSkateboardApp({
  constants,
  appRoutes,
  defaultRoute: 'home',
  landingPage: <Navigate to="/app/home" replace />,
  overrides: { layout: AppLayout, settings: SettingsView },
});

/** Preload HomeView chunk after initial render */
setTimeout(() => import('./components/HomeView'), 2000);
