import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { actions, useNet } from './net';
import { Home, Login, MatchFound, Matching } from './ui/Lobby';
import { Game } from './ui/Game';
import { Leaderboard } from './ui/Rank';
import { Teacher } from './ui/Teacher';
import { FeedbackModal } from './ui/Feedback';
import { HelpModal } from './ui/Tutorial';
import { Toasts } from './ui/common';

function App() {
  const net = useNet();
  const autoTutorial = useRef(false);
  let screen;
  if (net.view) screen = <Game view={net.view} />;
  else if (!net.authReady) screen = null;
  else if (!net.profile) screen = <Login />;
  else if (net.match) screen = <MatchFound />;
  else if (net.matching) screen = <Matching />;
  else if (net.showLeaderboard) screen = <Leaderboard />;
  else screen = <Home />;

  // 對局中整頁固定、不出現捲軸；其他畫面才允許在內容太長時捲動
  const inGame = Boolean(net.view);
  useEffect(() => {
    document.documentElement.classList.toggle('in-game', inGame);
    return () => document.documentElement.classList.remove('in-game');
  }, [inGame]);

  // 第一次登入：自動進入新手教學（只觸發一次；已在對局中的重連會被伺服器忽略）
  useEffect(() => {
    if (autoTutorial.current || !net.authReady || !net.profile || net.profile.tutorialDone) return;
    if (net.view || net.match || net.matching) return;
    autoTutorial.current = true;
    actions.startTutorial();
  }, [net.authReady, net.profile, net.view, net.match, net.matching]);

  return (
    <>
      {screen}
      <FeedbackModal />
      <HelpModal />
      <Toasts />
    </>
  );
}

const isTeacher = window.location.pathname.replace(/\/+$/, '') === '/teacher';
createRoot(document.getElementById('root')!).render(isTeacher ? <Teacher /> : <App />);
