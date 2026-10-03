const BaseScraper=require('./baseScraper');
const {searchWithCandidates,firstText,firstAttr,makeProduct}=require('./scraperUtils');
class OthobaScraper extends BaseScraper{
 constructor(){super('Othoba','https://othoba.com');}
 async search(query){
  const q=encodeURIComponent(query);
  const candidates=['https://othoba.com/ts/search/{q}/?pagenumber=1&q={q}&t=t'.replaceAll('{q}',q),'https://othoba.com/search?text={q}'.replace('{q}',q),'https://othoba.com/search?q={q}'.replace('{q}',q)];
  return searchWithCandidates(this,candidates,$=>{
   const out=[]; $('[class*="product"], [class*="Product"], article').each((i,el)=>{
    if(i>=20)return false; const $e=$(el);
    const name=firstText($e,[".product-name",".product-title","h3","h4"]);
    const price=firstText($e,[".price",".sale-price","[class*=\"price\"]"]);
    const originalPrice=firstText($e,["del",".old-price",".regular-price"]);
    const url=firstAttr($e,['a'],'href');
    const image=firstAttr($e,['img'],'src')||firstAttr($e,['img'],'data-src');
    const p=makeProduct(this,{name,price,originalPrice,url,image,inStock:!$e.text().match(/out of stock|sold out/i)});
    if(p)out.push(p);
   }); return out;
  }, [/(?:product|details)/i]) }
}
module.exports=OthobaScraper;
