const BaseScraper=require('./baseScraper');
const {searchWithCandidates,firstText,firstAttr,makeProduct}=require('./scraperUtils');
class PickabooScraper extends BaseScraper{
 constructor(){super('Pickaboo','https://www.pickaboo.com');}
 async search(query){
  const q=encodeURIComponent(query);
  const candidates=['https://www.pickaboo.com/search-result/{q}'.replace('{q}',q),
   'https://www.pickaboo.com/search?q={q}'.replace('{q}',q),'https://www.pickaboo.com/search?query={q}'.replace('{q}',q)];
  return searchWithCandidates(this,candidates,$=>{
   const out=[]; $('[class*="product"], [class*="Product"], article').each((i,el)=>{
    if(i>=20)return false; const $e=$(el);
    const name=firstText($e,[".product-title",".product-name","h2","h3","h4"]);
    const price=firstText($e,[".price",".special-price",".sale-price","[class*=\"price\"]"]);
    const originalPrice=firstText($e,[".old-price",".regular-price",".original-price","del"]);
    const url=firstAttr($e,['a'],'href');
    const image=firstAttr($e,['img'],'src')||firstAttr($e,['img'],'data-src');
    const p=makeProduct(this,{name,price,originalPrice,url,image,inStock:!$e.text().match(/out of stock|sold out/i)});
    if(p)out.push(p);
   }); return out;
  }, [/\.html(?:$|[?#])/i]) }
}
module.exports=PickabooScraper;
