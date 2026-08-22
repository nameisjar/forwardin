const { patchBaileysTcTokenHandler } = require('./patch-baileys-tctoken');
const { patchBaileysPollVoteSender } = require('./patch-baileys-poll-vote');

patchBaileysTcTokenHandler();
patchBaileysPollVoteSender();
require('./convert-images-to-base64');
