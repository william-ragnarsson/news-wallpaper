// Every integrated outlet, in sidebar order. Each module is hand-verified:
// see sources/README.md before adding one.

import foxNews from './fox-news.mjs';
import nyt from './nyt.mjs';
import vrtNws from './vrt-nws.mjs';
import washingtonPost from './washington-post.mjs';

export const OUTLETS = [
  vrtNws,
  nyt,
  washingtonPost,
  foxNews,
];
