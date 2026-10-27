import {useLayoutEffect,useRef} from 'react';
import type {ChangeEvent} from 'react';
import type {Currency} from './domain';
import {formatGiroMoneyEdit,formatGiroMoneyInput,giroMoneyInputError,parseGiroMoneyInput} from './giro-money';

export const moneyText=(amount:number|undefined,currency:Currency)=>
  amount===undefined?'':formatGiroMoneyInput(String(amount).replace('.',','),currency)||'';
export const parseMoneyText=parseGiroMoneyInput;
export const moneyTextError=giroMoneyInputError;

export function MoneyField({value,onChange,currency,name,required=false,readOnly=false,placeholder,className,ariaLabel}:{
  value:string;onChange:(value:string)=>void;currency:Currency;name?:string;required?:boolean;
  readOnly?:boolean;placeholder?:string;className?:string;ariaLabel?:string;
}){
  const input=useRef<HTMLInputElement>(null);
  const nextCaret=useRef<number|null>(null);
  useLayoutEffect(()=>{
    const element=input.current;
    if(nextCaret.current!==null&&element===document.activeElement)
      element?.setSelectionRange(nextCaret.current,nextCaret.current);
    nextCaret.current=null;
  },[value]);
  const change=(event:ChangeEvent<HTMLInputElement>)=>{
    const raw=event.currentTarget.value;
    const position=event.currentTarget.selectionStart??raw.length;
    const native=event.nativeEvent as InputEvent;
    const edit=formatGiroMoneyEdit(raw,position,value,currency,native.inputType,native.data||'');
    if(!edit){event.currentTarget.value=value;event.currentTarget.setSelectionRange(Math.min(position,value.length),Math.min(position,value.length));return}
    if(edit.value===value){event.currentTarget.value=value;event.currentTarget.setSelectionRange(edit.caret,edit.caret);return}
    nextCaret.current=edit.caret;
    onChange(edit.value);
  };
  return <input ref={input} type="text" inputMode="decimal" autoComplete="off" className={className||'money-edit-input'}
    aria-label={ariaLabel} name={name} value={value} onChange={change} required={required}
    readOnly={readOnly} placeholder={placeholder}/>;
}
