const BaseScraper=require('./baseScraper');
const {searchWithCandidates,firstText,firstAttr,makeProduct}=require('./scraperUtils');
class RokomariScraper extends BaseScraper{
 constructor(){super('Rokomari','https://www.rokomari.com');}
 async search(query){
  const q=encodeURIComponent(query);
  const candidates=[
   this.baseUrl+'/search?term='+q,
   this.baseUrl+'/search?q='+q,
   this.baseUrl+'/search?query='+q
  ];
  return searchWithCandidates(this,candidates,$=>{
   const out=[];
   $('.book-list-wrapper .book-card, .book-list-wrapper > div, .product-list .product-item, .product-item, [class*="product-card"]').each((i,el)=>{
    if(i>=20)return false; const $e=$(el);
    const name=firstText($e,['.book-title','.product-name','.product-title','.title','h3 a','h3','h4']);
    const price=firstText($e,['.book-price .current-price','.price .new-price','.product-price','.current-price','.price']);
    const originalPrice=firstText($e,['.book-price .old-price','.price .regular-price','.original-price','del']);
    const url=firstAttr($e,['a'],'href');
    const image=firstAttr($e,['img'],'src')||firstAttr($e,['img'],'data-src');
    const p=makeProduct(this,{name,price,originalPrice,url,image,inStock:!$e.text().match(/out of stock|sold out/i),isOfficial:true}); if(p)out.push(p);
   }); return out;
  });
 }
 async getProductFromUrl(url){
  try{
   const html=await this.fetchPage(url); if(!html)return null; const $=this.loadHTML(html);
   const name=firstText($('body'),['h1.product-title','h1.book-title','h1.product-name','h1']);
   const price=firstText($('body'),['.product-price .current-price','.book-price .current-price','.price .new-price','.current-price','.price']);
   const originalPrice=firstText($('body'),['.product-price .old-price','.book-price .old-price','.price .regular-price']);
   const image=firstAttr($,['.product-image img','.book-image img','img'],'src');
   const p=makeProduct(this,{name,price,originalPrice,url,image,inStock:!$('body').text().match(/out of stock|sold out/i),isOfficial:true});
   return p ? {...p,url} : null;
  }catch(e){console.error('[Rokomari] getProductFromUrl:',e.message);return null;}
 }
}
module.exports=RokomariScraper;
