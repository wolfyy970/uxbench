// Global test setup — injects chrome mock into globalThis
import { chrome } from './chrome';

(globalThis as any).chrome = chrome;
