import React, { useState, useEffect } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import qrcode from 'qrcode-terminal';

export interface DashboardController {
  setStatus: (status: ConnectionStatus) => void;
  setQRCode: (qr: string) => void;
  addMessage: (msg: Message) => void;
  stop: () => void;
  waitUntilExit: () => Promise<void>;
  /** Dipanggil ketika QR berhasil di-scan dan status connected */
  onConnected?: (callback: () => void) => void;
}

export type ConnectionStatus = 'connecting' | 'qr' | 'connected' | 'disconnected';

export interface Message {
  from: string;
  content: string;
  time: string;
  isAI: boolean;
}

export interface DashboardProps {
  version: string;
  model: string;
  dashboardUrl?: string;
  sessionName: string;
  /** Callback dipanggil saat QR berhasil di-scan dan status menjadi connected */
  onConnected?: () => void;
}

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  connecting: 'yellow',
  qr: 'yellow',
  connected: 'green',
  disconnected: 'red',
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: '● Connecting...',
  qr: '● QR Scan Required',
  connected: '● Connected',
  disconnected: '● Disconnected',
};

function Header({ version, status }: { version: string; status: ConnectionStatus }) {
  const uptime = useUptime(status === 'connected');
  return (
    <Box justifyContent="space-between" marginBottom={0}>
      <Box>
        <Text bold color="cyan">🤖 WAGENT</Text>
        <Text dimColor> v{version}</Text>
      </Box>
      <Box>
        <Text color={STATUS_COLORS[status]} bold>{STATUS_LABELS[status]}</Text>
        {status === 'connected' && <Text dimColor>   {uptime}</Text>}
      </Box>
    </Box>
  );
}

function StatusPanel({ model, dashboardUrl, sessionName }: Omit<DashboardProps, 'version'>) {
  return (
    <Box flexDirection="row" marginBottom={0} marginTop={0}>
      <Text dimColor>Model: </Text><Text color="yellow">{model}</Text>
      <Text dimColor>  |  Session: </Text><Text>{sessionName}</Text>
      {dashboardUrl && (
        <>
          <Text dimColor>  |  Dashboard: </Text><Text color="cyan">{dashboardUrl}</Text>
        </>
      )}
    </Box>
  );
}

function QRPanel({ qrCode }: { qrCode?: string }) {
  if (!qrCode) return null;
  return (
    <Box flexDirection="column" marginBottom={0} marginTop={0}>
      <Box><Text color="cyan" bold>📱 Scan QR code with WhatsApp:</Text></Box>
      <Box><Text dimColor>WhatsApp → ⋮ → Linked Devices → Link a Device</Text></Box>
      <Box marginTop={0} padding={1} backgroundColor="white" width={46} justifyContent="center" alignItems="center">
        <Text color="black" bold>{qrCode}</Text>
      </Box>
    </Box>
  );
}

function MessagesPanel({ messages, stats }: { messages: Message[]; stats: { total: number; today: number } }) {
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" marginBottom={0} marginTop={0}>
        <Box justifyContent="space-between">
          <Text dimColor>💬 Recent Messages</Text>
          <Text dimColor>{stats.today} today</Text>
        </Box>
        <Box marginTop={0}><Text dimColor>  No messages yet</Text></Box>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={0} marginTop={0}>
      <Box justifyContent="space-between">
        <Text dimColor>💬 Recent Messages</Text>
        <Text dimColor>{stats.total} total</Text>
      </Box>
      <Box marginTop={0} flexDirection="column">
        {messages.slice(0, 5).map((msg, i) => (
          <Box key={i}>
            <Text color="cyan">{msg.from.padEnd(16)}</Text>
            <Text>{msg.content.slice(0, 40).padEnd(42)}</Text>
            <Text dimColor>{msg.time.padEnd(8)}</Text>
            <Text color={msg.isAI ? 'green' : 'white'}>{msg.isAI ? '🤖' : '👤'}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function Footer() {
  return (
    <Box marginTop={0}>
      <Text dimColor>Ctrl+C: Stop   ?: Help</Text>
    </Box>
  );
}

function Separator() {
  return (
    <Box marginY={0}>
      <Text dimColor>{'─'.repeat(65)}</Text>
    </Box>
  );
}

function useUptime(running: boolean): string {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) {
      setSeconds(0);
      return;
    }
    const interval = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [running]);
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m ${secs}s`;
}

export function Dashboard({ version, model, dashboardUrl, sessionName, onConnected }: DashboardProps) {
  const [status, setStatusState] = useState<ConnectionStatus>('connecting');
  const [qrCode, setQrCode] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stats, setStats] = useState({ total: 0, today: 0 });
  // Lacak apakah QR pernah ditampilkan (artinya ini fresh pairing session)
  const qrWasShown = React.useRef(false);
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  // Expose control API via module-level ref
  useEffect(() => {
    if (controllerRef.current) {
      controllerRef.current.setStatus = (s) => {
        setStatusState(s);
        // Saat connected setelah QR di-scan, trigger onConnected lalu exit TUI
        if (s === 'connected' && qrWasShown.current && onConnected) {
          // Beri jeda singkat supaya UI sempat render status connected
          setTimeout(() => {
            onConnected();
            exit();
          }, 1500);
        }
      };
      controllerRef.current.setQRCode = (q) => {
        qrWasShown.current = true;
        setQrCode(q);
      };
      controllerRef.current.addMessage = (m) => {
        setMessages(prev => [m, ...prev].slice(0, 50));
        setStats(prev => ({ total: prev.total + 1, today: prev.today + 1 }));
      };
    }
  }, []);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Header version={version} status={status} />
      <Separator />
      <StatusPanel model={model} dashboardUrl={dashboardUrl} sessionName={sessionName} />
      {status === 'qr' && <QRPanel qrCode={qrCode} />}
      {status === 'connected' && <MessagesPanel messages={messages} stats={stats} />}
      <Footer />
    </Box>
  );
}

// Module-level controller shared between renderDashboard and the component
let controllerRef: { current: Partial<DashboardController> | null } = { current: null };

/**
 * Convert a raw QR data string into ASCII art (unicode block characters).
 * Uses qrcode-terminal's callback form to capture output instead of printing.
 */
export function renderQRToString(qr: string): string {
  let out = '';
  (qrcode as any).generate(qr, { small: true }, (output: string) => {
    out = output;
  });
  return out;
}

export function renderDashboard(props: DashboardProps): DashboardController {
  // Reset controller for this render
  const localController: Partial<DashboardController> = {};
  controllerRef.current = localController;

  let connectedCallback: (() => void) | undefined;

  const instance = render(
    <Dashboard
      {...props}
      onConnected={() => { connectedCallback?.(); }}
    />
  );

  const controller: DashboardController = {
    setStatus: (s) => { localController.setStatus?.(s); },
    setQRCode: (q) => { localController.setQRCode?.(q); },
    addMessage: (m) => { localController.addMessage?.(m); },
    stop: () => { instance.unmount(); },
    waitUntilExit: () => instance.waitUntilExit() as Promise<void>,
    onConnected: (cb) => { connectedCallback = cb; },
  };
  return controller;
}
