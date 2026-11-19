// Match only recorded catalog text; no inferred product/material specifications.
export function normalizeSearch(value){
 return String(value??'').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu,' ').trim();
}
export function matchesCatalogSearch(text,query){
 const normalized=normalizeSearch(text),compact=normalized.replace(/ /g,'');
 const terms=normalizeSearch(query).split(' ').filter(Boolean);
 if(!terms.length)return !String(query??'').trim();
 return terms.every(token=>normalized.includes(token)||compact.includes(token));
}
