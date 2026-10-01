'use client';
import { useCallback, useRef, useState } from 'react';
import LoginPanel, { type LoginPanelHandle } from './login-panel';
import TruckDoors, { useDoorIntro } from './truck-doors';

/** The truck's rear doors open and the sign-in panel comes out of the container. */
export default function LoginScreen() {
  const root = useRef<HTMLElement>(null);
  const panel = useRef<LoginPanelHandle>(null);
  const [leaving, setLeaving] = useState(false);
  const focusForm = useCallback(() => panel.current?.focusFirst(), []);
  const intro = useDoorIntro(root, focusForm);
  // The redirect does not wait for the fade: the app loads while it plays.
  const beforeRedirect = useCallback(async () => setLeaving(true), []);

  return <main ref={root} className={'login' + intro + (leaving ? ' saliendo' : '')}>
    <TruckDoors />
    <div className="login-capa">
      <LoginPanel ref={panel} beforeRedirect={beforeRedirect} />
    </div>
    <div className="login-fundido" aria-hidden="true" />
  </main>;
}
