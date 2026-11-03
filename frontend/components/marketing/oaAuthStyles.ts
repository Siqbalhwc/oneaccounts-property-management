// Generated from the ERP login page (oneaccounts-frontend, src/app/login/page.tsx) so the Property login looks identical.
// To change the shared look later, change it in both apps.
export const OA_AUTH_CSS = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Sora:wght@500;600;700&display=swap');

        .oa-page{--navy:#0B0A5C;--navy-deep:#07063A;--cream:#FAF8F4;--gold:#C9862F;--peach:#F3CFA6;--ink:#20202C;--ink-soft:#5B5A6B;--line:#E4DFD5;
          min-height:100vh;display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:24px;padding:24px;max-width:1680px;margin:0 auto;align-items:stretch;background:var(--cream);color:var(--ink);font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        .oa-page,.oa-page *{box-sizing:border-box}
        .oa-bg{background:radial-gradient(900px 520px at 12% 0,#EFE8DA,transparent 70%),radial-gradient(700px 480px at 100% 100%,#E9E7F4,transparent 70%),var(--cream);overflow-x:hidden}
        .oa-page>*{min-width:0}
        .oa-page h1,.oa-page h2,.oa-page .oa-display{font-family:'Sora','Inter',sans-serif}
        .oa-page a{color:inherit}
        .oa-page :focus-visible{outline:3px solid var(--gold);outline-offset:2px}

        /* Left (brand) panel */
        .oa-left{background:linear-gradient(160deg,var(--navy) 0%,var(--navy-deep) 100%);color:#fff;border-radius:16px;box-shadow:0 34px 64px -14px rgba(11,10,92,.45),0 12px 24px rgba(11,10,92,.14);padding:36px clamp(24px,3.2vw,56px);display:flex;flex-direction:column;gap:20px;min-height:0;overflow:auto}
        .oa-brand{display:flex;align-items:center;gap:14px}
        .oa-logo-tile{width:48px;height:48px;border-radius:50%;background:var(--cream);display:grid;place-items:center;flex:none}
        .oa-logo-tile img{width:32px;height:32px;object-fit:contain}
        .oa-brand-name{font-family:'Sora',sans-serif;font-weight:700;font-size:20px;line-height:1.1}
        .oa-brand-sub{font-size:12px;color:rgba(255,255,255,.7);margin-top:3px}
        .oa-kicker{align-self:flex-start;border:1px solid rgba(201,134,47,.6);color:var(--peach);background:rgba(201,134,47,.12);border-radius:999px;padding:6px 14px;font-size:12px;font-weight:500;letter-spacing:.02em}
        .oa-headline{font-family:'Sora',sans-serif;font-weight:700;font-size:clamp(26px,min(3.2vw,4.6vh),46px);line-height:1.12;margin:0;letter-spacing:-.01em}
        .oa-headline span{display:block;color:var(--peach)}
        .oa-label-top{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.65);margin:0 0 -8px}
        .oa-segs{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .oa-seg{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:4px;padding:13px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.04);transition:background .15s,border-color .15s}
        .oa-seg:hover{background:rgba(255,255,255,.09)}
        .oa-seg[aria-pressed="true"]{border-color:var(--gold);background:rgba(201,134,47,.16)}
        .oa-seg:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
        .oa-seg-top{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px}
        .oa-seg-top svg{color:var(--peach);flex:none}
        .oa-seg-desc{font-size:12px;color:rgba(255,255,255,.68);line-height:1.4}
        .oa-outcome{margin:0;font-size:15px;line-height:1.6;color:rgba(255,255,255,.88);min-height:48px}

        .oa-example{background:#FFFDF8;color:var(--ink);border-radius:6px;padding:16px 20px 14px 22px;border:1px solid #E6DCC4;border-left:5px double var(--gold);box-shadow:4px 4px 0 -1px #F7F0DE,8px 8px 0 -2px #EEE4CA}
        .oa-ex-kick{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--gold)}
        .oa-ex-title{font-family:'Sora',sans-serif;font-weight:600;font-size:17px;margin:4px 0 12px}
        .oa-ex-row{display:flex;justify-content:space-between;gap:12px;font-size:14px;padding:7px 0;border-bottom:1px dashed var(--line);color:var(--ink-soft)}
        .oa-ex-row b{color:var(--ink);font-weight:600;white-space:nowrap}
        .oa-ex-result{display:flex;justify-content:space-between;gap:12px;padding-top:11px;font-weight:600;font-size:15px;color:var(--navy)}
        .oa-ex-note{margin:10px 0 0;font-size:11px;color:var(--ink-soft)}

        .oa-how{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;font-size:13px;color:rgba(255,255,255,.82)}
        .oa-how strong{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.6);font-weight:600}
        .oa-how span.n{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--gold);color:var(--navy-deep);font-weight:700;font-size:12px;margin-right:6px}
        .oa-copy{margin-top:auto;font-size:12px;color:rgba(255,255,255,.55)}

        /* Right (form) panel */
        .oa-right{display:flex;background:#fff;border:1px solid #E6DCC4;border-left:5px double var(--gold);border-radius:16px;box-shadow:5px 5px 0 -1px #F7F0DE,10px 10px 0 -2px #EEE4CA,0 34px 64px -14px rgba(11,10,92,.28),0 12px 24px rgba(11,10,92,.08);padding:28px clamp(20px,3.5vw,52px);min-height:0;overflow:auto}
        .oa-card{width:100%;max-width:440px;margin:auto;background:transparent;padding:0}
        .oa-secure{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--gold)}
        .oa-title{font-family:'Sora',sans-serif;font-weight:700;font-size:26px;margin:10px 0 4px;color:var(--navy)}
        .oa-sub{margin:0 0 22px;font-size:14px;color:var(--ink-soft)}
        .oa-msg{display:flex;gap:10px;align-items:flex-start;border-radius:8px;padding:12px 14px;font-size:13.5px;line-height:1.5;margin-bottom:16px}
        .oa-error{background:#FDF0EE;color:#8F2A1D;border:1px solid #F1C9C2}
        .oa-success{background:#EEF6EF;color:#245A31;border:1px solid #C7E0CB}
        .oa-msg svg{flex:none;margin-top:2px}
        .oa-confirm{text-align:center;background:#EEF6EF;border:1px solid #C7E0CB;border-radius:10px;padding:18px 16px;margin-bottom:18px;color:#245A31}
        .oa-confirm h2{margin:8px 0 4px;font-size:17px}
        .oa-confirm p{margin:0;font-size:13.5px;line-height:1.55}
        .oa-field{margin-bottom:16px}
        .oa-field label{display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:var(--ink)}
        .oa-input-wrap{position:relative}
        .oa-input{width:100%;height:46px;border:1px solid #CFC9BC;border-radius:8px;padding:0 14px;font:inherit;font-size:15px;color:var(--ink);background:#fff}
        .oa-input:focus{outline:3px solid rgba(201,134,47,.45);outline-offset:0;border-color:var(--gold)}
        .oa-input.has-toggle{padding-right:70px}
        .oa-toggle{all:unset;box-sizing:border-box;position:absolute;right:6px;top:6px;height:34px;padding:0 10px;display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:12.5px;font-weight:600;color:var(--navy);border-radius:6px}
        .oa-toggle:hover{background:var(--cream)}
        .oa-toggle:focus-visible{outline:3px solid var(--gold)}
        .oa-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:-2px 0 18px;font-size:13px}
        .oa-remember{display:flex;align-items:center;gap:8px;color:var(--ink-soft);cursor:pointer}
        .oa-remember input{width:16px;height:16px;accent-color:var(--navy);cursor:pointer}
        .oa-forgot{color:var(--navy);font-weight:600;text-decoration:none}
        .oa-forgot:hover{text-decoration:underline}
        .oa-btn{width:100%;height:50px;border:0;border-radius:8px;background:var(--navy);color:#fff;font-family:'Sora',sans-serif;font-weight:600;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:background .15s}
        .oa-btn:hover:not(:disabled){background:var(--navy-deep)}
        .oa-btn:disabled{opacity:.75;cursor:wait}
        .oa-spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:oa-spin .7s linear infinite}
        @keyframes oa-spin{to{transform:rotate(360deg)}}
        .oa-secure-note{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;font-size:12px;color:var(--ink-soft)}
        .oa-switch-row{text-align:center;margin-top:14px}
        .oa-switch{all:unset;cursor:pointer;font-size:13.5px;color:var(--ink-soft)}
        .oa-switch strong{color:var(--navy);text-decoration:underline;text-underline-offset:3px}
        .oa-switch:focus-visible{outline:3px solid var(--gold);outline-offset:3px;border-radius:4px}
        .oa-or{display:flex;align-items:center;gap:12px;margin:20px 0 14px;font-size:12px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.08em}
        .oa-or::before,.oa-or::after{content:"";flex:1;height:1px;background:var(--line)}
        .oa-trial{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;height:auto;min-height:48px;padding:10px 14px;border:2px solid var(--gold);border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;color:var(--navy);background:#fff}
        .oa-trial:hover{background:#FFF8EE}
        .oa-trial-tag{font-size:11px;font-weight:600;letter-spacing:.05em;color:#fff;background:var(--gold);border-radius:999px;padding:3px 9px}
        .oa-note{margin:8px 0 0;text-align:center;font-size:12.5px;color:var(--ink-soft)}
        .oa-prop{margin:16px 0 0;text-align:center;font-size:13px;color:var(--ink-soft)}
        .oa-prop a{color:var(--navy);font-weight:600}
        .oa-addons{margin-top:22px;padding-top:16px;border-top:1px solid var(--line);font-size:12.5px;color:var(--ink-soft);line-height:1.6}
        .oa-addons b{color:var(--ink);font-weight:600}
        .oa-addon-list{display:flex;flex-wrap:wrap;gap:6px 14px;margin:6px 0 4px}
        .oa-addon-list span{display:inline-flex;align-items:center;gap:6px}
        .oa-addon-list svg{color:var(--gold)}
        .oa-help{margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}
        .oa-help p{margin:0 0 8px;font-size:12.5px;font-weight:600;color:var(--ink)}
        .oa-contact{display:flex;flex-wrap:wrap;gap:8px 16px;overflow-wrap:anywhere}
        .oa-contact a{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--navy);text-decoration:none}
        .oa-contact a:hover{text-decoration:underline}

        @media (min-width:961px){
          .oa-page{height:100vh;height:100dvh;min-height:0;padding:clamp(10px,2.2vh,24px) 24px;gap:clamp(14px,2vw,24px)}
          .oa-left{justify-content:space-between;gap:clamp(8px,1.4vh,18px);padding-top:clamp(16px,3.2vh,40px);padding-bottom:clamp(16px,3.2vh,40px)}
          .oa-brand-name{font-size:clamp(18px,2.6vh,24px)}
          .oa-headline{font-size:clamp(26px,min(3.2vw,5.2vh),54px)}
          .oa-seg{padding:clamp(8px,1.5vh,16px) 14px}
          .oa-seg-top{font-size:clamp(13px,1.8vh,15px)}
          .oa-outcome{font-size:clamp(13px,1.9vh,16px);min-height:0}
          .oa-example{padding:clamp(12px,2vh,22px) 20px clamp(10px,1.8vh,18px) 22px}
          .oa-ex-title{font-size:clamp(15px,2.2vh,19px);margin:4px 0 clamp(4px,1.2vh,12px)}
          .oa-ex-row{padding:clamp(3px,.9vh,8px) 0;font-size:clamp(13px,1.8vh,15px)}
          .oa-ex-result{padding-top:clamp(6px,1.2vh,12px)}
          .oa-how{font-size:clamp(12.5px,1.8vh,14px)}
          .oa-copy{margin-top:0}
          .oa-right{padding-top:clamp(14px,2.6vh,28px);padding-bottom:clamp(14px,2.6vh,28px)}
          .oa-input{height:clamp(40px,5.4vh,46px)}
          .oa-btn{height:clamp(42px,5.8vh,50px)}
        }
        @media (min-width:961px) and (max-height:820px){.oa-ex-note,.oa-copy,.oa-addons{display:none}}
        @media (min-width:961px) and (max-height:760px){.oa-prop,.oa-secure-note{display:none}}
        @media (min-width:961px) and (max-height:700px){.oa-kicker{display:none}.oa-title{font-size:22px}.oa-field{margin-bottom:10px}.oa-or{margin:10px 0}}
        @media (min-width:961px) and (max-height:660px){.oa-seg-desc{display:none}}
        @media (min-width:1200px) and (max-height:660px){.oa-segs{grid-template-columns:repeat(4,1fr)}}
        @media (min-width:961px) and (max-height:600px){.oa-label-top,.oa-ex-kick,.oa-sub,.oa-brand-sub{display:none}}
        @media (min-width:961px) and (max-height:520px){.oa-outcome{display:none}}
        @media (max-width:960px){
          .oa-page{grid-template-columns:1fr;gap:14px;padding:12px}
          .oa-right{order:-1;padding:24px 16px}
          .oa-left{padding:24px 18px;overflow:visible}
        }
        @media (max-width:360px){
          .oa-left,.oa-right{padding-left:14px;padding-right:14px}
          .oa-headline{font-size:26px}
        }
        @media (max-width:420px){
          .oa-segs{grid-template-columns:1fr}
          .oa-title{font-size:23px}
        }
        @media (prefers-reduced-motion:reduce){
          .oa-spinner{animation-duration:2s}
          .oa-seg,.oa-btn{transition:none}
        }
      `
