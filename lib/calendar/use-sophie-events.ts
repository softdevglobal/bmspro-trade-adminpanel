"use client";

import {useAuth} from "@/lib/auth/auth-context";
import {useCallback,useEffect,useState} from "react";
import type {SophieCalendarItem} from "./sophie-events";

/** Deliberately no polling: date changes and explicit refresh load bounded ranges. */
export function useSophieEvents(enabled:boolean,from:string,to:string){
 const {user,businessId,role}=useAuth();
 const active=enabled&&role==="business_owner"&&!!user&&!!businessId;
 const key=active?`${user?.uid}:${businessId}:${from}:${to}`:"";
 const [state,setState]=useState<{key:string;items:SophieCalendarItem[];partial:boolean;error:string|null}>({key:"",items:[],partial:false,error:null});
 const [version,setVersion]=useState(0);
 const [pending,setPending]=useState("");
 useEffect(()=>{
  if(!active||!user)return;
  const controller=new AbortController();
  void(async()=>{
   try{
    const token=await user.getIdToken();
    if(controller.signal.aborted)return;
    setPending(key);
    const response=await fetch(`/api/calendar/sophie?from=${from}&to=${to}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store",signal:controller.signal});
    const payload=await response.json();
    if(!response.ok||!Array.isArray(payload.items))throw new Error(payload.error||"Could not load Sophie activities.");
    if(!controller.signal.aborted)setState({key,items:payload.items,partial:payload.partial===true,error:null});
   }catch(error){if(!controller.signal.aborted)setState({key,items:[],partial:false,error:error instanceof Error?error.message:"Could not load Sophie activities."});}
   finally{if(!controller.signal.aborted)setPending("");}
  })();
  return()=>controller.abort();
 },[active,user,key,from,to,version]);
 const reload=useCallback(()=>setVersion(value=>value+1),[]);
 const current=active&&state.key===key;
 return {items:current?state.items:[],partial:current&&state.partial,error:current?state.error:null,loading:active&&(pending===key||state.key!==key),reload};
}
