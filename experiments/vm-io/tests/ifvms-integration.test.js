'use strict';
// ifvms.js ZVM integration: the shared acceptance-mapping suite against the
// in-process vendored ZVM (Windows-native evidence layer).

const { integrate } = require('./integrate.js');

integrate('ifvms', false);
