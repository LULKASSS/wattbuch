"""Apple-TV-Steuerung für die Wattbuch Mac-App, läuft mit pyatv in einem eigenen Python (siehe appletv.js).
Spricht JSON-Zeilen über stdin/stdout: Anfrage {"id":1,"cmd":"scan"} → Antwort {"id":1,"ok":true,...}.
Meldungen ohne id: {"ev":"state","connected":true,...} und {"ev":"play","state":"playing","title":...}.
Zugangsdaten aus dem Koppeln speichert pyatv in der Datei, die als erstes Argument kommt."""
import asyncio
import json
import sys

import pyatv
from pyatv import exceptions
from pyatv.const import DeviceState, OperatingSystem, PairingRequirement, Protocol
from pyatv.interface import DeviceListener, PushListener
from pyatv.storage.file_storage import FileStorage

REMOTE = {'up', 'down', 'left', 'right', 'select', 'menu', 'home', 'play_pause', 'play', 'pause', 'skip_forward', 'skip_backward'}
AUDIO = {'volume_up', 'volume_down'}
PLAY = {DeviceState.Playing: 'playing', DeviceState.Paused: 'paused', DeviceState.Loading: 'loading', DeviceState.Seeking: 'playing'}
ORDER = [Protocol.MRP, Protocol.AirPlay, Protocol.Companion]


def emit(msg):
    sys.stdout.write(json.dumps(msg) + '\n')
    sys.stdout.flush()


class Helper(PushListener, DeviceListener):
    def __init__(self, loop, store):
        self.loop, self.store = loop, store
        self.confs, self.atv, self.handler, self.todo, self.pair_conf = {}, None, None, [], None
        self.atv_name, self.proto, self.keys = None, None, asyncio.Lock()

    # Meldungen vom Apple TV
    def playstatus_update(self, _updater, p):
        app = None
        try:
            app = self.atv.metadata.app.name if self.atv and self.atv.metadata.app else None
        except Exception:
            pass
        emit({'ev': 'play', 'state': PLAY.get(p.device_state, 'idle'), 'title': p.title or p.series_name or None, 'app': app})

    def playstatus_error(self, _updater, _e):
        pass

    def connection_lost(self, _e):
        self.atv = None
        emit({'ev': 'state', 'connected': False})

    def connection_closed(self):
        self.connection_lost(None)

    async def find(self, ident):
        if ident not in self.confs:
            for c in await pyatv.scan(self.loop, timeout=5, identifier=ident, storage=self.store):
                self.confs[ident] = c
        if ident not in self.confs:
            raise RuntimeError('Apple TV nicht gefunden. Ist es eingeschaltet und im selben WLAN?')
        return self.confs[ident]

    async def scan(self, _a):
        found = []
        for c in await pyatv.scan(self.loop, timeout=5, storage=self.store):
            if c.device_info.operating_system != OperatingSystem.TvOS:
                continue
            self.confs[c.identifier] = c
            found.append({'id': c.identifier, 'name': c.name, 'model': c.device_info.model_str})
        return {'devices': found}

    async def begin_next(self):
        self.proto = self.todo.pop(0)
        self.handler = await pyatv.pair(self.pair_conf, self.proto, self.loop, storage=self.store, name='Wattbuch')
        await self.handler.begin()
        return {'protocol': self.proto.name, 'pin': self.handler.device_provides_pin}

    async def pair(self, a):
        await self.cancel(None)
        conf = await self.find(a['dev'])
        need = (PairingRequirement.Mandatory, PairingRequirement.Optional)
        self.todo = [p for p in ORDER if (s := conf.get_service(p)) and s.pairing in need and not s.credentials]
        self.pair_conf = conf
        if not self.todo:
            return {'done': True}
        return await self.begin_next()

    async def pin(self, a):
        if not self.handler:
            raise RuntimeError('Kein Koppeln aktiv')
        self.handler.pin(int(a['pin']))
        try:
            await self.handler.finish()
            ok = self.handler.has_paired
        except exceptions.PairingError:
            ok = False
        await self.handler.close()
        self.handler = None
        if not ok:
            # Falscher Code: dasselbe noch einmal, der Fernseher zeigt dann einen neuen
            self.todo.insert(0, self.proto)
            await self.begin_next()
            raise RuntimeError('Code stimmt nicht. Auf dem Fernseher steht jetzt ein neuer.')
        await self.store.save()
        if self.todo:
            return {'next': await self.begin_next()}
        self.confs.pop(self.pair_conf.identifier, None)
        return {'done': True}

    async def cancel(self, _a):
        if self.handler:
            await self.handler.close()
            self.handler = None
        self.todo = []
        return {}

    async def connect(self, a):
        if self.atv:
            return {'name': self.atv_name}
        self.confs.pop(a['dev'], None)
        conf = await self.find(a['dev'])
        try:
            self.atv = await pyatv.connect(conf, self.loop, storage=self.store)
        except exceptions.AuthenticationError as e:
            raise RuntimeError('Kopplung abgelaufen, bitte neu koppeln') from e
        self.atv_name = conf.name
        self.atv.listener = self
        self.atv.push_updater.listener = self
        self.atv.push_updater.start()
        emit({'ev': 'state', 'connected': True, 'name': conf.name})
        return {'name': conf.name}

    async def key(self, a):
        k = a['key']
        if not self.atv:
            raise RuntimeError('Nicht verbunden')
        if k not in REMOTE and k not in AUDIO:
            raise RuntimeError('Unbekannte Taste')
        async with self.keys:  # Tasten der Reihe nach, auch wenn sie schnell hintereinander kommen
            await getattr(self.atv.remote_control if k in REMOTE else self.atv.audio, k)()
        return {}

    async def disconnect(self, _a):
        if self.atv:
            atv, self.atv = self.atv, None
            await asyncio.gather(*atv.close(), return_exceptions=True)
        return {}


async def main():
    loop = asyncio.get_running_loop()
    store = FileStorage(sys.argv[1], loop)
    await store.load()
    h = Helper(loop, store)
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    emit({'ev': 'ready'})

    async def run(req):
        try:
            res = await getattr(h, req['cmd'])(req)
            emit({'id': req['id'], 'ok': True, **(res or {})})
        except Exception as e:  # Fehler gehen als Text an die Seite
            msg = str(e) or type(e).__name__
            if 'No route to host' in msg or 'Errno 65' in msg:
                msg = 'macOS sperrt das lokale Netzwerk: Systemeinstellungen → Datenschutz & Sicherheit → Lokales Netzwerk → Wattbuch einschalten.'
            emit({'id': req['id'], 'ok': False, 'error': msg})

    tasks = set()
    while line := await reader.readline():
        try:
            req = json.loads(line)
        except ValueError:
            continue
        if req.get('cmd') not in ('scan', 'pair', 'pin', 'cancel', 'connect', 'key', 'disconnect'):
            emit({'id': req.get('id'), 'ok': False, 'error': 'Unbekannter Befehl'})
            continue
        t = loop.create_task(run(req))
        tasks.add(t)
        t.add_done_callback(tasks.discard)
    await h.disconnect(None)


if __name__ == '__main__':
    asyncio.run(main())
