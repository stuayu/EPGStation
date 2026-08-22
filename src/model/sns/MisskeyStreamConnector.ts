import { injectable } from 'inversify';
import WebSocket from 'ws';
import IMisskeyStreamConnector from './IMisskeyStreamConnector';

@injectable()
export default class MisskeyStreamConnector implements IMisskeyStreamConnector {
    public connect(host: string, token: string): WebSocket {
        return new WebSocket(`wss://${host}/streaming?i=${encodeURIComponent(token)}`);
    }
}
