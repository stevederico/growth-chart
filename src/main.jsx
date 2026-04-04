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
import { createSkateboardApp } from '@stevederico/skateboard-ui/App';
import { Spinner } from '@stevederico/skateboard-ui/shadcn/ui/spinner';
import Layout from '@stevederico/skateboard-ui/Layout';
import CommandMenu from './components/CommandMenu.jsx';
import constants from './constants.json';
const HomeView = lazy(() => import('./components/HomeView.jsx'));
const SettingsView = lazy(() => import('./components/SettingsView.jsx'));

/**
 * App layout with global command menu overlay.
 *
 * @returns {JSX.Element} Layout with command menu
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
 *
 * @type {Array<{path: string, element: JSX.Element}>}
 */
const appRoutes = [
  {
    path: 'home',
    element: (
      <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Spinner /></div>}>
        <HomeView />
      </Suspense>
    ),
  },
  {
    path: 'settings',
    element: (
      <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Spinner /></div>}>
        <SettingsView />
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
  overrides: { layout: AppLayout },
});

/** Preload HomeView chunk after initial render */
setTimeout(() => import('./components/HomeView.jsx'), 2000);
