const BaseScraper=require('./baseScraper');
const {searchWithCandidates,firstText,firstAttr,makeProduct}=require('./scraperUtils');
class DazzleScraper extends BaseScraper{
 constructor(){super('Dazzle','https://dazzle.com.bd');}
 async search(query){
  const q=encodeURIComponent(query);
  const candidates=['https://dazzle.com.bd/search?q={q}'.replace('{q}',q),'https://dazzle.com.bd/search?query={q}'.replace('{q}',q)];
  return searchWithCandidates(this,candidates,$=>{
   const out=[]; $('[class*="product"], article').each((i,el)=>{
    if(i>=20)return false; const $e=$(el);
    const name=firstText($e,[".product-title",".product-name","h3","h4"]);
    const price=firstText($e,[".price",".sale-price","[class*=\"price\"]"]);
    const originalPrice=firstText($e,["del",".old-price",".regular-price"]);
    const url=firstAttr($e,['a'],'href');
    const image=firstAttr($e,['img'],'src')||firstAttr($e,['img'],'data-src');
    const p=makeProduct(this,{name,price,originalPrice,url,image,inStock:!$e.text().match(/out of stock|sold out/i)});
    if(p)out.push(p);
   }); return out;
  });
 }
}
module.exports=DazzleScraper;
