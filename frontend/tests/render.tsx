import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { AppShell } from "@/components/AppShell";

/** Renders a view inside the shared shell (header, health polling, banners), as in the app. */
export const renderInShell = (ui: ReactElement) => render(<AppShell>{ui}</AppShell>);
