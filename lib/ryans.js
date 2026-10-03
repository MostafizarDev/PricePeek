const BaseScraper=require('./baseScraper');
const {searchWithCandidates,firstText,firstAttr,makeProduct}=require('./scraperUtils');
class RyansScraper extends BaseScraper{
 constructor(){super('Ryans','https://www.ryans.com');}
 async search(query){
  const q=encodeURIComponent(query);
  const candidates=[
   this.baseUrl+'/search?q='+q,
   this.baseUrl+'/search?query='+q,
   this.baseUrl+'/search?search='+q,
   this.baseUrl+'/search?term='+q
  ];
  return searchWithCandidates(this,candidates,$=>{
   const out=[];
   $('.category-single-product, .product-item, .product-card, [class*="product-card"]').each((i,el)=>{
    if(i>=20)return false; const $e=$(el);
    const name=firstText($e,['h4.product-title a','h4.product-title','.product-title','.product-name','h3','h4']);
    const price=firstText($e,['.pr-text.cat-sp-text','.price-new','.special-price','.product-price','.price']);
    const originalPrice=firstText($e,['.new-reg-text','.price-old','.old-price','.regular-price','del']);
    const url=firstAttr($e,['.image-box a','h4.product-title a','.product-title a','a'],'href');
    const image=firstAttr($e,['.image-box img','.card-img-top','img'],'src')||firstAttr($e,['img'],'data-src');
    const p=makeProduct(this,{name,price,originalPrice,url,image,inStock:!$e.text().match(/out of stock|sold out/i)}); if(p)out.push(p);
   }); return out;
  }, [/^\\/[^/?#]+$/]);
 } async getProductFromUrl(url){
  try{
   const html=await this.fetchPage(url); if(!html)return null; const $=this.loadHTML(html);
   const name=firstText($('body'),['h1.product-title','h1.product-name','h1']);
   const price=firstText($('body'),['.product-price','.pr-text','.price-new','.special-price']);
   const originalPrice=firstText($('body'),['.new-reg-text','.old-price','.regular-price']);
   const image=firstAttr($,['.product-image img','.image-box img','img'],'src');
   const p=makeProduct(this,{name,price,originalPrice,url,image,inStock:!$('body').text().match(/out of stock|sold out/i)});
   return p ? {...p,url} : null;
  }catch(e){console.error('[Ryans] getProductFromUrl:',e.message);return null;}
 }
}
module.exports=RyansScraper;
