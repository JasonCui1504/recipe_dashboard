import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, Outlet, RouterProvider } from 'react-router-dom';
import { EmptyState } from './components/common';
import { Layout } from './components/Layout';
import { CookingMode } from './pages/CookingMode';
import { Discover } from './pages/Discover';
import { GroceryPlan } from './pages/GroceryPlan';
import { Library } from './pages/Library';
import { Pantry } from './pages/Pantry';
import { Planner } from './pages/Planner';
import { RecipeDetail } from './pages/RecipeDetail';
import { RecipeEditorPage } from './pages/RecipeEditor';
import { Settings } from './pages/Settings';
import { Shopping } from './pages/Shopping';
import { ConfirmProvider, RecipesProvider, ToastProvider } from './state';
import './styles.css';

function NotFound() {
  return (
    <div className="page">
      <EmptyState title="Page not found">
        <Link to="/" className="btn btn-primary">
          Go to Discover
        </Link>
      </EmptyState>
    </div>
  );
}

function Providers() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <RecipesProvider>
          <Outlet />
        </RecipesProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Providers />,
    children: [
      // Cooking mode is full-screen, without the site navigation.
      { path: '/recipes/:id/cook', element: <CookingMode /> },
      {
        element: <Layout />,
        children: [
          { path: '/', element: <Discover /> },
          { path: '/recipes', element: <Library /> },
          { path: '/recipes/new', element: <RecipeEditorPage /> },
          { path: '/recipes/:id', element: <RecipeDetail /> },
          { path: '/recipes/:id/edit', element: <RecipeEditorPage /> },
          { path: '/planner', element: <Planner /> },
          { path: '/shopping', element: <Shopping /> },
          { path: '/shopping/plan', element: <GroceryPlan /> },
          { path: '/pantry', element: <Pantry /> },
          { path: '/settings', element: <Settings /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
