import type { ReactNode } from "react";
import { I18nScope } from "@/i18n/scope";

export default function Layout({ children }: { children: ReactNode }) { return <I18nScope namespaces={['admin']}>{children}</I18nScope>; }
