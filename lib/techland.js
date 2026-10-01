const BaseScraper=require('./baseScraper');
const {searchWithCandidates,firstText,firstAttr,makeProduct}=require('./scraperUtils');
class TechLandScraper extends BaseScraper{
 constructor(){super('TechLand','https://www.techlandbd.com');}
 async search(query){
  const q=encodeURIComponent(query);
  const candidates=['https://www.techlandbd.com/search?search={q}'.replace('{q}',q),'https://www.techlandbd.com/index.php?route=product/search&search={q}'.replace('{q}',q),'https://www.techlandbd.com/shop-laptop-computer?search={q}'.replace('{q}',q)];
  return searchWithCandidates(this,candidates,$=>{
   const out=[]; $('.product-layout, .product-thumb, .product-grid, [class*="product-card"]').each((i,el)=>{
    if(i>=20)return false; const $e=$(el);
    const name=firstText($e,[".caption h4",".product-title",".name","h3","h4"]);
    const price=firstText($e,[".price-new",".price",".special-price","[class*=\"price\"]"]);
    const originalPrice=firstText($e,[".price-old",".old-price","del"]);
    const url=firstAttr($e,['a'],'href');
    const image=firstAttr($e,['img'],'src')||firstAttr($e,['img'],'data-src');
    const p=makeProduct(this,{name,price,originalPrice,url,image,inStock:!$e.text().match(/out of stock|sold out/i)});
    if(p)out.push(p);
   }); return out;
  });
 }
}
module.exports=TechLandScraper;
