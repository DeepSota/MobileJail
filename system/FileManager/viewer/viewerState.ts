export type DocumentViewerState =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'missing'
  | 'unsupported'
  | 'corrupted'
  | 'password-protected'
  | 'too-large'
  | 'converter-offline'
  | 'busy'
  | 'timeout';

export type ViewerStateReporter = (state: DocumentViewerState) => void;
