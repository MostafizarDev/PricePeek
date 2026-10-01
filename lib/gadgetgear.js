const BaseScraper=require('./baseScraper');
const {searchWithCandidates,firstText,firstAttr,makeProduct}=require('./scraperUtils');
class GadgetGearScraper extends BaseScraper{
 constructor(){super('GadgetGear','https://gadgetandgear.com');}
 async search(query){
  const q=encodeURIComponent(query);
  const candidates=['https://gadgetandgear.com/search/{q}'.replace('{q}',q),'https://gadgetandgear.com/search?q={q}'.replace('{q}',q),'https://gadgetandgear.com/shop?search={q}'.replace('{q}',q)];
  return searchWithCandidates(this,candidates,$=>{
   const out=[]; $('[class*="product"], [class*="Product"], article').each((i,el)=>{
    if(i>=20)return false; const $e=$(el);
    const name=firstText($e,[".product-title",".product-name","h2","h3","h4"]);
    const price=firstText($e,[".price",".sale-price","[class*=\"price\"]"]);
    const originalPrice=firstText($e,["del",".old-price",".compare-price",".regular-price"]);
    const url=firstAttr($e,['a'],'href');
    const image=firstAttr($e,['img'],'src')||firstAttr($e,['img'],'data-src');
    const p=makeProduct(this,{name,price,originalPrice,url,image,inStock:!$e.text().match(/out of stock|sold out/i)});
    if(p)out.push(p);
   }); return out;
  });
 }
}
module.exports=GadgetGearScraper;
