const BaseScraper=require('./baseScraper');
const {searchWithCandidates,firstText,firstAttr,makeProduct}=require('./scraperUtils');
class ChaldalScraper extends BaseScraper{
 constructor(){super('Chaldal','https://chaldal.com');}
 async search(query){
  const q=encodeURIComponent(query);
  return searchWithCandidates(this,[this.baseUrl+'/search/'+q,this.baseUrl+'/search?query='+q,this.baseUrl+'/?search='+q],$=>{
   const out=[]; $('[class*="product"], [class*="Product"], article').each((i,el)=>{
    if(i>=20)return false; const $e=$(el);
    const name=firstText($e,['.name','.product-name','.product-title','h3','h4']);
    const price=firstText($e,['.price','.product-price','[class*="price"]']);
    const originalPrice=firstText($e,['del','.old-price','.regular-price']);
    const url=firstAttr($e,['a'],'href');
    const image=firstAttr($e,['img'],'src')||firstAttr($e,['img'],'data-src');
    const p=makeProduct(this,{name,price,originalPrice,url,image,inStock:!$e.text().match(/out of stock|sold out/i)});
    if(p)out.push(p);
   }); return out;
  }, [/(?:product|details)/i]) }
}
module.exports=ChaldalScraper;
