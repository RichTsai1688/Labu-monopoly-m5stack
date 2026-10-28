/** Atlas coordinates are presentation-only; money and outcomes always come from engine logs. */
export function eventPresentation(text: string): {title:string;cell:number} {
 if (/創意獎|完成「/.test(text)) return {title:'城市獎勵',cell:0};
 if (/租金|付租|免租/.test(text)) return {title:/免租/.test(text)?'免租成功':'租金結算',cell:1};
 if (/建設|升為|買下|標下/.test(text)) return {title:/買下|標下/.test(text)?'新的城市地產':'房屋升級',cell:2};
 if (/股利|配息|除息/.test(text)) return {title:'股利結算',cell:9};
 if (/入獄|監獄|服刑|保釋|出獄|通緝/.test(text)) return {title:'監獄事件',cell:5};
 if (/保守|下跌/.test(text)) return {title:'股市轉冷',cell:8};
 if (/樂觀|買進|賣出|股票|清算/.test(text)) return {title:'股票動態',cell:7};
 if (/車行|車庫|交通|購買.*車|換乘/.test(text)) return {title:'出發去兜風',cell:10};
 if (/公園|起點/.test(text)) return {title:'城市小確幸',cell:11};
 if (/存款|提款|銀行/.test(text)) return {title:'銀行收支',cell:3};
 if (/稅|費|支付|偷取|陷阱|破產/.test(text)) return {title:/偷取|陷阱/.test(text)?'惡作劇事件':'費用結算',cell:4};
 return {title:/獲得|抽|使用|購買/.test(text)?'驚喜事件':'城市動態',cell:6};
}
