'use client';
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Command as CommandPrimitive } from 'cmdk';
import { ArrowLeftRight, BookOpen, Boxes, ClipboardCheck, ClipboardList, Home, ListChecks, LogOut, Map as MapIcon, Menu, Monitor, RefreshCw, Rotate3d, Search, Tags, Users, X, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { PublicUser } from '@/lib/identity';
import type { State } from '@/lib/warehouse';
import { formatPallets, stockBySku } from '@/lib/warehouse-insights';
import { returnToLogin } from '@/lib/client-session';
import Logo from './logo';

export type InventoryView = 'resumen' | '3d' | 'referencias' | 'ubicaciones' | 'movimientos' | '5s' | 'cierre' | 'protocolo';
export type NavKey = 'inicio' | 'operaciones' | 'usuarios' | `inventario:${InventoryView}`;
type NavItem = { key: NavKey; label: string; href: string; Icon: LucideIcon; admin?: boolean };

export const inventoryViews: { view: InventoryView; label: string; Icon: LucideIcon }[] = [
  { view: 'resumen', label: 'Existencias', Icon: Boxes },
  { view: '3d', label: 'Vista 3D', Icon: Rotate3d },
  { view: 'referencias', label: 'Referencias', Icon: Tags },
  { view: 'ubicaciones', label: 'Ubicaciones', Icon: MapIcon },
  { view: 'movimientos', label: 'Movimientos', Icon: ArrowLeftRight },
  { view: '5s', label: 'Plan 5S', Icon: ListChecks },
  { view: 'cierre', label: 'Cierre de turno', Icon: ClipboardCheck },
  { view: 'protocolo', label: 'Protocolo', Icon: BookOpen },
];
const inventoryItem = (view: InventoryView): NavItem => {
  const item = inventoryViews.find(entry => entry.view === view)!;
  return { key: `inventario:${view}`, label: item.label, Icon: item.Icon, href: view === 'resumen' ? '/inventario' : `/inventario?vista=${view}` };
};
const groups: { title: string; items: NavItem[] }[] = [
  { title: 'Turno', items: [
    { key: 'inicio', label: 'Inicio', href: '/', Icon: Home },
    { key: 'operaciones', label: 'Organización', href: '/operaciones', Icon: ClipboardList },
  ] },
  { title: 'Almacén', items: (['resumen', '3d', 'referencias', 'ubicaciones', 'movimientos'] as const).map(inventoryItem) },
  { title: 'Rutina', items: (['5s', 'cierre', 'protocolo'] as const).map(inventoryItem) },
  { title: 'Administración', items: [{ key: 'usuarios', label: 'Personas y accesos', href: '/usuarios', Icon: Users, admin: true }] },
];

export type PaletteAction = { label: string; hint?: string; Icon: LucideIcon; run: () => void };

type Props = {
  user: PublicUser;
  active: NavKey;
  data?: State;
  sync: { updatedAt: string; error: string; busy: boolean; refresh: () => void };
  actions?: PaletteAction[];
  children: ReactNode;
};

const time = (date: string) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(date));

export default function AppShell({ user, active, data, sync, actions = [], children }: Props) {
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const pathname = usePathname();
  const router = useRouter();
  const visible = groups.map(group => ({ ...group, items: group.items.filter(item => !item.admin || user.role === 'administrador') })).filter(group => group.items.length);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette(open => !open); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // Inventory sections share one page: switching between them only changes the query string.
  function navigate(href: string, event?: MouseEvent) {
    setMenu(false);
    setPalette(false);
    if (pathname === '/inventario' && href.startsWith('/inventario')) {
      event?.preventDefault();
      window.history.pushState(null, '', href);
      window.scrollTo({ top: 0 });
      return;
    }
    if (!event) router.push(href);
  }

  async function logout() {
    try { const response = await fetch('/api/session', { method: 'DELETE' }); if (!response.ok) throw new Error(); returnToLogin(); }
    catch { setLogoutError('No se ha podido cerrar la sesión. Vuelve a intentarlo.'); }
  }

  const status = sync.error ? 'Sin conexión' : sync.updatedAt ? `Actualizado a las ${time(sync.updatedAt)}` : 'Conectando…';
  const title = visible.flatMap(group => group.items).find(item => item.key === active)?.label ?? '';

  return <div className={'shell' + (menu ? ' menu-open' : '')}>
    <aside className="sidebar" aria-label="Navegación">
      <div className="sidebar-head">
        <Link href="/" className="wordmark" onClick={() => setMenu(false)}><span className="glyph"><Logo variant="lima" size="62%" data-logo-target=""/></span>Burriana</Link>
        <button className="icon-btn sidebar-close" aria-label="Cerrar menú" onClick={() => setMenu(false)}><X size={18}/></button>
      </div>
      <button className="sidebar-search" onClick={() => { setMenu(false); setPalette(true); }}><Search size={15}/><span>Buscar</span><kbd>⌘K</kbd></button>
      <nav>
        {visible.map(group => <div className="nav-group" key={group.title}>
          <h2>{group.title}</h2>
          {group.items.map(({ key, label, href, Icon }) => <Link key={key} href={href} aria-current={key === active ? 'page' : undefined} onClick={event => navigate(href, event)}><Icon size={17}/>{label}</Link>)}
        </div>)}
      </nav>
      <div className="sidebar-foot">
        <a className="display-link" href="/pantalla" target="_blank" rel="noreferrer"><Monitor size={17}/><span>Pantalla del almacén<small>Se abre en otra pestaña</small></span></a>
        <div className="me">
          <span className="avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="me-text"><b>{user.name}</b><small>{user.role === 'administrador' ? 'Administrador' : 'Encargado'}</small></span>
          <button className="icon-btn" onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut size={16}/></button>
        </div>
        {logoutError && <p className="sidebar-error" role="alert">{logoutError}</p>}
      </div>
    </aside>
    <div className="scrim" onClick={() => setMenu(false)} aria-hidden="true"/>
    <div className="main">
      <header className="toolbar">
        <button className="icon-btn menu-btn" aria-label="Abrir menú" onClick={() => setMenu(true)}><Menu size={19}/></button>
        <span className="toolbar-title">{title}</span>
        <div className="toolbar-end">
          <span className={'sync' + (sync.error ? ' offline' : '')} role="status"><i aria-hidden="true"/>{status}</span>
          <button className="icon-btn" onClick={sync.refresh} disabled={sync.busy} aria-label="Actualizar datos" title="Actualizar datos"><RefreshCw size={16}/></button>
          <button className="icon-btn toolbar-search" onClick={() => setPalette(true)} aria-label="Buscar"><Search size={17}/></button>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
    <Palette open={palette} onOpenChange={setPalette} groups={visible} actions={actions} data={data} onNavigate={href => navigate(href)}/>
  </div>;
}

function Palette({ open, onOpenChange, groups, actions, data, onNavigate }: { open: boolean; onOpenChange: (open: boolean) => void; groups: { title: string; items: NavItem[] }[]; actions: PaletteAction[]; data?: State; onNavigate: (href: string) => void }) {
  const stock = useMemo(() => data ? stockBySku(data) : new Map<string, number>(), [data]);
  const firstLocation = useMemo(() => {
    const map = new Map<string, string>();
    for (const location of data?.locations ?? []) if (location.qty && !map.has(location.sku)) map.set(location.sku, location.id);
    return map;
  }, [data]);
  const orders = (data?.workOrders ?? []).filter(order => !['completada', 'cancelada'].includes(order.status)).slice(0, 30);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="palette" showCloseButton={false}>
      <DialogTitle className="sr-only">Buscar</DialogTitle>
      <DialogDescription className="sr-only">Busca secciones, referencias, ubicaciones u órdenes y pulsa Intro para abrirlas.</DialogDescription>
      <CommandPrimitive label="Buscar" loop>
        <div className="palette-input"><Search size={18}/><CommandPrimitive.Input autoFocus placeholder="Buscar referencias, ubicaciones, órdenes o secciones"/></div>
        <CommandPrimitive.List className="palette-list">
          <CommandPrimitive.Empty className="palette-empty">Sin resultados. Prueba con el SKU, el modelo o el código de ubicación.</CommandPrimitive.Empty>
          {actions.length > 0 && <CommandPrimitive.Group heading="Acciones">
            {actions.map(action => <CommandPrimitive.Item key={action.label} value={`accion ${action.label}`} onSelect={() => { onOpenChange(false); action.run(); }}><action.Icon size={17}/><span>{action.label}</span>{action.hint && <small>{action.hint}</small>}</CommandPrimitive.Item>)}
          </CommandPrimitive.Group>}
          {data && data.products.length > 0 && <CommandPrimitive.Group heading="Referencias">
            {data.products.map(product => {
              const location = firstLocation.get(product.sku);
              const href = location ? `/inventario?vista=3d&ubicacion=${encodeURIComponent(location)}` : `/inventario?vista=referencias&q=${encodeURIComponent(product.sku)}`;
              return <CommandPrimitive.Item key={product.id} value={`${product.name} ${product.sku}`} onSelect={() => onNavigate(href)}>
                <Tags size={17}/><span>{product.name}<em>{product.sku}</em></span><small>{formatPallets(stock.get(product.sku) ?? 0)} palets</small>
              </CommandPrimitive.Item>;
            })}
          </CommandPrimitive.Group>}
          {data && data.locations.length > 0 && <CommandPrimitive.Group heading="Ubicaciones">
            {data.locations.map(location => <CommandPrimitive.Item key={location.id} value={`ubicacion ${location.code} ${location.zone}`} onSelect={() => onNavigate(`/inventario?vista=3d&ubicacion=${encodeURIComponent(location.id)}`)}>
              <MapIcon size={17}/><span>{location.code}<em>{location.zone}</em></span><small>{location.qty ? `${formatPallets(location.qty)} palets` : 'Libre'}</small>
            </CommandPrimitive.Item>)}
          </CommandPrimitive.Group>}
          {orders.length > 0 && <CommandPrimitive.Group heading="Órdenes activas">
            {orders.map(order => <CommandPrimitive.Item key={order.id} value={`orden ${order.title} ${order.reference} ${order.truck}`} onSelect={() => onNavigate('/operaciones')}>
              <ClipboardList size={17}/><span>{order.title}<em>{order.reference}</em></span>
            </CommandPrimitive.Item>)}
          </CommandPrimitive.Group>}
          <CommandPrimitive.Group heading="Ir a">
            {groups.flatMap(group => group.items).map(({ key, label, href, Icon }) => <CommandPrimitive.Item key={key} value={`ir ${label}`} onSelect={() => onNavigate(href)}><Icon size={17}/><span>{label}</span></CommandPrimitive.Item>)}
          </CommandPrimitive.Group>
        </CommandPrimitive.List>
      </CommandPrimitive>
    </DialogContent>
  </Dialog>;
}
