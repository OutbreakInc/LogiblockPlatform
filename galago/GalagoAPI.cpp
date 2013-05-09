#include "GalagoAPI.h"
#include "LPC13xx.h"

#include <stdarg.h>

//strictly a property of the circuit the chip is soldered to
#define HARDWARE_EXTERNAL_CRYSTAL_FREQUENCY (12000000UL)


using namespace LPC1300;
using namespace Galago;

extern int __heap_start__;
extern int __heap_end__;

static unsigned int* const	__heapstart = (unsigned int* const)(&__heap_start__);
static unsigned int* const	__heapend = (unsigned int* const)(&__heap_end__);	//assume 512-byte stack

namespace Galago
{
	IO		io;
	System system;
}
	

////////////////////////////////////////////////////////////////
//

Task&					Task::operator =(Task const& t)
{
	refer(t._t);
	release(_t);
	_t = t._t;
	return(*this);
}

struct TaskUnion
{
	Task			self;
	unsigned short	count;
};

void	TaskUnion_onCompletion(void* context, Task t, bool success)
{
	TaskUnion* u = (TaskUnion*)context;
	Task self = u->self;
	
	if(!success)
	{
		if(--u->count == 0)
		{
			//delete[] u->tasks;
			delete u;
		}
		system.completeTask(self, false);
	}
	else
	{
		if(--u->count == 0)
		{
			//delete[] u->tasks;
			delete u;
			
			system.completeTask(self, true);
		}
	}
}

Task				Task::operator +(Task const& r) const
{
	TaskUnion* u = new TaskUnion();
	u->self = system.createTask();
	system.when(*this, &TaskUnion_onCompletion, u);
	system.when(r, &TaskUnion_onCompletion, u);
	
	return(u->self);
}

void				Task::release(InternalTask* t)	//static
{
	if(t && (--t->_rc == 0))
		t->destroy();
}

////////////////////////////////////////////////////////////////
//

		CircularBuffer::CircularBuffer(int size)
{
	_start = _head = _tail = new byte[size];
	_end = _start + size;
}
		CircularBuffer::~CircularBuffer(void)
{
	delete[] _start;
}
bool	CircularBuffer::write(byte b)
{
	byte* n = _head + 1;
	if(n == _end)	n = _start;
	if(n == _tail)	return(false);
	*(_head = n) = b;
	return(true);
}
int	CircularBuffer::write(byte const* b, int length)
{
	int count = 0;
	while((length--) && write(*b++))	count++;
	return(count);
}

bool	CircularBuffer::read(byte* b)
{
	byte* n = _tail + 1;
	if(n == _end)	n = _start;
	if(n == _head)	return(false);
	*b = *(_tail = n);
	return(true);
}

int		CircularBuffer::read(byte* b, int length)
{
	int count = 0;
	while((length--) && read(b++))	count++;
	return(count);
}

////////////////////////////////////////////////////////////////
// IOCore

struct IOCore
{
	struct TaskQueueItem
	{
		TaskQueueItem*	next;
		Task			task;
		
						TaskQueueItem(void):
							next(0)
		{}
	};
	
	struct TimerTask: public TaskQueueItem
	{
		unsigned int	span;	//timespan from now until the task is due, in ms
		
						TimerTask(unsigned int s): span(s)
		{}
	};
	
	struct ADCTask: public TaskQueueItem
	{
		int				channel;
		unsigned int*	output;
		
						ADCTask(int chan, unsigned int* out):
							channel(chan),
							output(out)
		{}
	};
	
	struct WriteTask: public TaskQueueItem
	{
		unsigned short	idx;
		unsigned short	len;
		byte			data[1];

						WriteTask(byte const* bytes, int l):
							idx(0),
							len(l)
		{
			for(int i = 0; i < l; i++)
				data[i] = *bytes++;
		}
	};
	
	TimerTask*		timerCurrentTask;
	
	ADCTask*		adcCurrentTask;
	
	CircularBuffer*	uartReceiveBuffer;
	WriteTask*		uartCurrentWriteTask;
	
	WriteTask*		i2cCurrentTask;
	
	WriteTask*		spiCurrentTask;
	
					IOCore(void):
						timerCurrentTask(0),
						adcCurrentTask(0),
						uartReceiveBuffer(0),
						uartCurrentWriteTask(0),
						i2cCurrentTask(0),
						spiCurrentTask(0)
	{
		//uartReceiveBuffer = new CircularBuffer(128);	//@@defer until UART is started, free when stopped
	}
	
	static void		queueItem(TaskQueueItem** head, TaskQueueItem* item)
	{
		InterruptsDisable();
		while(*head != 0)
			head = &((*head)->next);
		*head = item;
		InterruptsEnable();
	}
};

static IOCore IOCore;

////////////////////////////////////////////////////////////////
// System

				System::System(void)
{
	//initialize heap
	*(unsigned int*)__heapstart = ((__heapend - __heapstart) >> 2);
	
	//enable IO configuration
	*ClockControl |= ClockControl_IOConfig;

}

static unsigned int	System_getPLLInputFrequency(void)
{
	switch(*PLLSource)
	{
	default:
	case PLLSource_InternalCrystal:
		return(12000000UL);
	case PLLSource_ExternalClock:
		return(HARDWARE_EXTERNAL_CRYSTAL_FREQUENCY);
	}
}

static unsigned int	System_getPLLOutputFrequency(void)
{
	//the PLL on the LPC1xxx parts isn't very well designed, as the fixed relationship between
	//  FCLKOUT, the M-divider and FCLKIN means that the output is always an integer multiple
	//  of the input.  A better design would use relationship: Fcco / M = Fin; Fout = Fcco / D.
	//  (The LPC1xxx uses relationship: Fcco / D / M = Fin; Fout = Fcco / D.)
	
	return(System_getPLLInputFrequency() * ((*PLLControl & PLLControl_MultiplierBitsMask) + 1));
}

unsigned int	System::getMainClockFrequency(void) const
{
	switch(*MainClockSource)
	{
	default:
	case MainClockSource_InternalCrystal:
		return(12000000UL);
	case MainClockSource_PLLInput:
		return(System_getPLLInputFrequency());
	case MainClockSource_WDTOscillator:
		return(3400000UL);		//@@todo: confirm this is a reliable figure
	case MainClockSource_PLLOutput:
		return(System_getPLLOutputFrequency());
	}
}

//this is also the AHB (main high-speed bus) frequency
unsigned int	System::getCoreFrequency(void) const
{
	//note no /0 check, but I would be very alarmed if this code could excecute with a stopped core :-/
	return(getMainClockFrequency() / *MainBusDivider);
}

void			System_strobeClockUpdateEnable(REGISTER updateEnable)
{
	*updateEnable = 1;
	*updateEnable = 0;
	*updateEnable = 1;
	
	while(!(*updateEnable & 1));	//spinwait for the change to take effect before returning
}

unsigned int	System_divideClockFrequencyRounded(unsigned int n, unsigned int d)
{
	unsigned int q = (((n << 1) / d) + 1) >> 1;
	return(q? q : 1);
}
void			System::setCoreFrequency(unsigned int desiredFrequency)
{
	//128KHz is established as a practical minimum
	if(desiredFrequency < 128000UL)
		desiredFrequency = 128000UL;
	if(desiredFrequency > 72000000UL)
		desiredFrequency = 72000000UL;
	
	//ensure the internal crystal is on
	*PowerDownControl &= ~(PowerDownControl_InternalCrystalOutput | PowerDownControl_InternalCrystal);
	
	*MainClockSource = MainClockSource_InternalCrystal;
	System_strobeClockUpdateEnable(MainClockSourceUpdate);
	
	//ensure the external crystal is on, as it's used in both cases.
	*PowerDownControl &= ~PowerDownControl_SystemOscillator;
	
	if(desiredFrequency > 12000000UL)	//must use PLL > 12MHz	@@to MAX(12e6, HARDWARE_EXTERNAL_CRYSTAL_FREQUENCY)
	{
		//turn on the PLL
		*PowerDownControl &= ~PowerDownControl_SystemPLL;
		
		*PLLSource = PLLSource_ExternalClock;
		System_strobeClockUpdateEnable(PLLSourceUpdate);
		
		//pick a multiplier in the range [2..6] and divider such that the error is as small as possible
		unsigned int bestM = 2, bestD = 1, smallestError = 0xFFFFFFFF, busFrequency;
		for(unsigned int m = 2; m < 7; m++)
		{
			busFrequency = HARDWARE_EXTERNAL_CRYSTAL_FREQUENCY * m;
			unsigned int div = System_divideClockFrequencyRounded(busFrequency, desiredFrequency);
			
			int error = (int)desiredFrequency - (int)(busFrequency / div);
			if(error < 0)	error = -error;	//use abs(error)
			
			if(error < smallestError)
			{
				smallestError = error;
				bestM = m;
				bestD = div;
			}
		}
		
		//set the PLL's multiplication factor
		*PLLControl = bestM;
		
		//wait for lock
		while(!(*PLLStatus & PLLStatus_Locked));
		
		//run the core from the PLL
		*MainClockSource = MainClockSource_PLLOutput;
		System_strobeClockUpdateEnable(MainClockSourceUpdate);
		
		//with this divider:
		*MainBusDivider = bestD;
		
		//adjust the SysTick timer to have a nominal rate of 1kHz
		*SystickClockDivider = busFrequency / 1000;
	}
	else
	{
		//run the core from the external clock with a divider
		
		//select the external clock as the input to the PLL
		*PLLSource = PLLSource_ExternalClock;
		System_strobeClockUpdateEnable(PLLSourceUpdate);
		
		//drive the main clock from the PLL input (ignores the PLL)
		*MainClockSource = MainClockSource_PLLInput;
		System_strobeClockUpdateEnable(MainClockSourceUpdate);
		
		//compute the closest division ratio
		*MainBusDivider = System_divideClockFrequencyRounded(HARDWARE_EXTERNAL_CRYSTAL_FREQUENCY, desiredFrequency);
		
		//turn off the PLL if it was on
		*PowerDownControl |= PowerDownControl_SystemPLL;
		
		//adjust the SysTick timer to have a nominal rate of 1kHz
		*SystickClockDivider = HARDWARE_EXTERNAL_CRYSTAL_FREQUENCY / 1000;
	}
}

unsigned int	System::getClockOutputFrequency(void) const
{
	unsigned int fMain;
	switch(*ClockOutputSource)
	{
	case ClockOutputSource_InternalCrystal:
		fMain = 12000000UL;
		break;
	case ClockOutputSource_ExternalOscillator:
		fMain = HARDWARE_EXTERNAL_CRYSTAL_FREQUENCY;
		break;
	case ClockOutputSource_WDTOscillator:
		fMain = 3400000UL;
		break;
	case ClockOutputSource_MainClock:
		fMain = getMainClockFrequency();
		break;
	}
	
	unsigned int div = *ClockOutputDivider;
	return(div? (fMain / div) : 0);
}

void	System::setClockOutputFrequency(unsigned int desiredFrequency)
{
	if(desiredFrequency > 0)
	{
		*ClockOutputDivider = System_divideClockFrequencyRounded(getMainClockFrequency(), desiredFrequency);
	}
	else
		*ClockOutputDivider = 0;	//disable
}


////////////////////////////////////////////////////////////////
// Memory management


static const unsigned int kHeapFlagMask = 0xFF000000;
static const unsigned int kHeapAllocated = 0x80000000;

//static
void*			System::alloc(size_t size)
{
	if(size == 0)	return(0);	//@@throw
	
	unsigned int* m = (unsigned int*)__heapstart;
	
	//allocations are (4 + size) bytes, rounded up to the next 4-byte boundary
	unsigned int s = (unsigned int)((size + 7) >> 2);
	
	while(m < __heapend)
	{
		unsigned int bs = *m & kHeapFlagMask;
		//look for an unallocated block big enough to fit this allocation
		if(!(*m & kHeapAllocated) && (s < bs))
		{
			if((bs - s) > 1)		//if there's any meaningful remainder,
				m[s] = (bs - s);	//	mark the remainder as free
			else
				s = bs;	//expand allocation
			
			*m = s | kHeapAllocated;	//allocate
			
			for(int i = 1; i < s; i++)	//zero memory
				m[i] = 0;
			
			return(m + 1);
		}
		m += bs;
	}
	return(0);	//@@throw
}

//static
void			System::free(void* allocation)
{
	unsigned int* a = (unsigned int*)allocation;
	
	if((a < __heapstart) || (a >= __heapend) || !(a[-1] & kHeapAllocated))
		return;	//@@throw
	
	a--;	//unwrap
	*a &= ~kHeapAllocated;	//free block

	unsigned int cbs = (*a & ~kHeapFlagMask);	//current block size
	
	for(int i = 1; i < cbs; i++)	//mark memory as free
		a[i] = 0xfeeefeee;
	
	//defragment heap
	unsigned int* n = a + cbs;				//next block
	if(!(*n & kHeapAllocated))						//if the next block is free,
		cbs += (*n & ~kHeapFlagMask);				//	account for it when freeing
	
	for(unsigned int* p = (unsigned int*)__heapstart; p < a;)
	{
		unsigned int pbs = *p & ~kHeapFlagMask;
		if(((p + pbs) == a) && !(*p & kHeapAllocated))	//predecessor is free
		{
			a = p;
			cbs += pbs;
		}
		p += pbs;
	}
	
	*a = cbs;	//merge free blocks if contiguous
}


////////////////////////////////////////////////////////////////
// Tasks

//Tasks are promises

namespace Galago {

struct InternalTaskCallback
{
	void	(*f)(void* context, Task, bool success);
	void*	c;
};

}

void			InternalTask::destroy(void)
{
	if((_flags & 0x3FFF) > 0)
		delete[] _c;
	delete this;
}

Task			System::createTask(void)
{
	//when tasks are created, they're created as unresolved promises with no callback capability
	InternalTask* task = new InternalTask();
	task->_rc = task->_flags = 0;
	task->_c = 0;
	
	return(Task(task));
}

bool			System::completeTask(Task t, bool success)
{
	if((t._t == 0) || (t._t->_flags > 0x3FFF))	//if invalid or already resolved, fail
		return(false);
	
	t._t->_flags |= (success? (1 << 14) : (1 << 15));	//status
	
	//@@defer until not in the NVIC stack any longer, then call user callbacks
	InternalTaskCallback* callbacks = t._t->_c;
	int numCallbacks = t._t->_flags & 0x3FFF;
	for(int i = 0; i < numCallbacks; i++)
		callbacks[i].f(callbacks[i].c, t, success);
	
	return(true);
}

//remember, on ARM Cortex-M (especially NXP parts), optimize for small RAM and program size because the CPU is
//  comparitively disproportionally, insanely, stupidly fast. (Remember 75MHz Pentiums in the '90s with 2000x the RAM
//  these microcontrollers have?
bool			System::when(Task t, void (*completion)(void* context, Task, bool success), void* context)
{
	if((t._t == 0) || (completion == 0))	//if invalid, fail
		return(false);
	
	if(t._t->_flags > 0x3FFF)	//already resolved, act on promise
	{
		completion(context, t, (t._t->_flags < 0x8000));
		return(true);
	}
	
	//if the callback:context tuple is already present, do nothing
	InternalTaskCallback* callbacks = t._t->_c;
	int numCallbacks = t._t->_flags & 0x3FFF;
	for(int i = 0; i < numCallbacks; i++)
		if((callbacks[i].f == completion) && (callbacks[i].c == context))
			return(true);
	
	//add the callback:context tuple to the task
	InternalTaskCallback* newCallbacks = new InternalTaskCallback[numCallbacks + 1];
	
	for(int i = 0; i < numCallbacks; i++)
		newCallbacks[i] = callbacks[i];
	
	newCallbacks[numCallbacks].f = completion;
	newCallbacks[numCallbacks].c = context;
	
	t._t->_c = newCallbacks;
	t._t->_flags++;	//count the new callback
	
	if(numCallbacks)
		delete[] callbacks;
	
	return(true);
}

bool			System::wait(Task t, System::InvokeCallbacksOption invokeCallbacks)
{
	if(t._t == 0)	return(false);
	
	//a mini event-loop!
	while(t._t->_flags < 0x4000)	//while not resolved
		sleep();	//service interrupts and the like	//@@???
	
	return(t._t->_flags < 0x8000);
}

static void		System_wakeFromSpan(void)
{
	//take the current systick down-counter value
	//subtract that value from the span
	//subtract the span from each queued task
	
	unsigned int span = *SystickReload - *SystickValue;
	for(IOCore::TimerTask* timer = IOCore.timerCurrentTask; timer != 0; timer = (IOCore::TimerTask*)timer->next)
		timer->span = (timer->span > span)? (timer->span - span) : 0;
}
static void		System_reloadSystick(int milliseconds)
{
	*SystickReload = milliseconds;
	*SystickValue = 0;
	*SystickControl = SystickControl_Enable | SystickControl_InterruptEnabled;
}

Task			System::delay(int milliseconds)
{
	System_wakeFromSpan();
	
	//insert a task into the queue
	IOCore::TimerTask* timer = new IOCore::TimerTask(milliseconds);
	timer->task = system.createTask();
	
	IOCore.queueItem((IOCore::TaskQueueItem**)&IOCore.timerCurrentTask, timer);
	
	//if the queue was empty, enable the systick timer/interrupt and set the span
	if(timer->next == 0)
		System_reloadSystick(milliseconds);
}

//fundamental frequency of 1kHz
extern "C"
void			_InternalIRQ_SysTick(void)
{
	System_wakeFromSpan();
	
	bool reloaded = false;
	
	//if we're at a deadline, deadline = dequeue the top task(s)
	for(IOCore::TimerTask* timer = IOCore.timerCurrentTask; timer != 0;)
	{
		if(timer->span == 0)
		{
			system.completeTask(timer->task, true);
			IOCore::TimerTask* old = timer;
			
			timer = (IOCore::TimerTask*)timer->next;
			
			delete old;
		}
		else if(!reloaded)
		{
			reloaded = true;
			
			//reload systick and span with the delay of the top task or disable it
			System_reloadSystick(timer->span);
		}
	}
	
	if(!reloaded)
		*SystickValue = *SystickReload = *SystickControl = 0;	//stop timer
}


////////////////////////////////////////////////////////////////
//IO Pins

//Pins must be optimized for these operations in this priority order:

//Output logic level, input logic level
//  requires fast lookup to an IO port num and the pin's bit position
//Setting mode
//  I/O direction r/w should be superfast, requires IO port num and pin bit position
//  requires lookup of an IO configuration address for the pin
//Read analog level, where supported

//therefore, I/O Pin objects should store the port number [0,3], pin number [0,11] and a dense pin ID
//  io port mask:	0xFF000000
//	pin num mask:	0x00FF0000
//	pin id mask:	0x0000FFFF

enum
{
	PIN_P0,	PIN_P1, PIN_P2, PIN_P3, PIN_P4, PIN_P5, PIN_P6,
	
	PIN_DP, PIN_DM,
	
	PIN_RTS, PIN_CTS, PIN_TXD, PIN_RXD,
	
	PIN_SCL, PIN_SDA,
	
	PIN_SCK, PIN_SEL, PIN_MISO, PIN_MOSI,
	
	PIN_A0, PIN_A1, PIN_A2, PIN_A3, PIN_A5, PIN_A7,
	
	PIN_LED,
};


//Pin feature and mode lookup tables
static unsigned int const kPinSupportsGPIO =(0xFFFFFFF & ~(_BIT(PIN_DP)) | _BIT(PIN_DM));
static unsigned int const kPinSupportsADC =	(_BIT(PIN_A0) | _BIT(PIN_A1) | _BIT(PIN_A2) | _BIT(PIN_A3)
	| _BIT(PIN_A5) | _BIT(PIN_A7));
static unsigned int const kPinSupportsI2C =	(_BIT(PIN_SCL) | _BIT(PIN_SDA));
static unsigned int const kPinSupportsSPI =	(_BIT(PIN_SCK) | _BIT(PIN_SEL) | _BIT(PIN_MISO) | _BIT(PIN_MOSI));
static unsigned int const kPinSupportsPWM =	(_BIT(PIN_P1) | _BIT(PIN_P5) | _BIT(PIN_TXD) | _BIT(PIN_RXD) |
	_BIT(PIN_MISO) | _BIT(PIN_MOSI) | _BIT(PIN_A0) | _BIT(PIN_A2) | _BIT(PIN_A3) | _BIT(PIN_A5) | _BIT(PIN_LED));
static unsigned int const kPinSupportsUART =	(_BIT(PIN_RTS) | _BIT(PIN_CTS) | _BIT(PIN_TXD) | _BIT(PIN_RXD));
static unsigned int const kPinSupportsSpecial =	(_BIT(PIN_P0) | _BIT(PIN_P1) | _BIT(PIN_DP) | _BIT(PIN_DM)
	| _BIT(PIN_A5));	//P0 is !reset, P1 is clkout, A5 is wakeup
static unsigned int const kPinFunc1IsGPIO =	(_BIT(PIN_P0) | _BIT(PIN_A0) | _BIT(PIN_A1)
	| _BIT(PIN_A2) | _BIT(PIN_A3));	//otherwise it's func 0
static unsigned int const kPinFunc1IsADC =	(_BIT(PIN_A5) | _BIT(PIN_A7));		//otherwise it's func 2
//I2C is always func 1
//SPI is always func 1 except for gpio0.6, where it's 2
static unsigned int const kPinFunc2IsPWM =	(_BIT(PIN_P1) | _BIT(PIN_MISO) | _BIT(PIN_MOSI) | _BIT(PIN_A5)
	| _BIT(PIN_TXD) | _BIT(PIN_RXD) | _BIT(PIN_LED));	//otherwise it's func 3 except for gpio1.9 where it's 1
//UART is always func 1
//Special is always 1 except for gpio0.0 where it's 0


#define PIN_STATE(pinID, ioPort, ioPinNumber)		((ioPort << 24) | (ioPinNumber << 16) | pinID)
#define PIN_ID(v)					(v >> 16)
#define PIN_IO_PORT(v)				((v >> 8) & 0xFF)
#define PIN_IO_PIN_NUM(v)			(v & 0xFF)
#define PIN_GPIO_DATA_PORT(port)	REGISTER_ADDRESS(0x50000000 | (port << 16))
#define PIN_GPIO_DIR_PORT(port)		REGISTER_ADDRESS(0x50008000 | (port << 16))
static unsigned int const kIOPinChart[] =	//@@this could be reduced to 1/4 its size to save 78 bytes :-o
{
	PIN_STATE(PIN_P0, 0, 0),	//P0
	PIN_STATE(PIN_P1, 0, 1),	//P1
	PIN_STATE(PIN_P2, 1, 8),	//P2
	PIN_STATE(PIN_P3, 0, 2),	//P3
	PIN_STATE(PIN_P4, 0, 3),	//P4
	PIN_STATE(PIN_P5, 1, 9),	//P5
	PIN_STATE(PIN_P6, 3, 2),	//P6
	
	PIN_STATE(PIN_DM, 3, 4),	//D-
	PIN_STATE(PIN_DP, 3, 5),	//D+

	PIN_STATE(PIN_RTS, 1, 5),	//RTS
	PIN_STATE(PIN_CTS, 0, 7),	//CTS
	PIN_STATE(PIN_TXD, 1, 7),	//TXD
	PIN_STATE(PIN_RXD, 1, 6),	//RXD

	PIN_STATE(PIN_SDA, 0, 5),	//SDA
	PIN_STATE(PIN_SCL, 0, 4),	//SCL

	PIN_STATE(PIN_SCK, 0, 6),	//SCK
	PIN_STATE(PIN_SEL, 2, 0),	//SEL
	PIN_STATE(PIN_MISO, 0, 8),	//MISO
	PIN_STATE(PIN_MOSI, 0, 9),	//MOSI

	PIN_STATE(PIN_A0, 0, 11),	//A0
	PIN_STATE(PIN_A1, 1, 0),	//A1
	PIN_STATE(PIN_A2, 1, 1),	//A2
	PIN_STATE(PIN_A3, 1, 2),	//A3
	PIN_STATE(PIN_A5, 1, 4),	//A5
	PIN_STATE(PIN_A7, 1, 11),	//A7

	PIN_STATE(PIN_LED, 1, 10),	//led
};

#define PIN_IOCONFIG_ADDRESS(pinID)	REGISTER_ADDRESS(0x40044000 + IO_ioConfigForPin[pinID])
static unsigned char const IO_ioConfigForPin[] =
{
	0x0C, 0x10, 0x14, 0x1C, 0x2C, 0x38, 0x3C,	//P0, P1, P2, P3, P4, P5, P6
	0x48, 0x9C,									//D-, D+
	0xA0, 0x50, 0xA8, 0xA4,						//RTS, CTS, TXD, RXD
	0x34, 0x30,									//SDA, SCL
	0x4C, 0x0C, 0x60, 0x64,						//SCK, SEL, MISO, MOSI
	0x74, 0x78, 0x7C, 0x80, 0x94, 0x98,			//A0, A1, A2, A3, A5, A7
	0x6C,										//LED
};

				IO::IO(void)
{
	*IOConfigSCKLocation = 2;	//put SCK0 on pin pio0.6, labeled 'SCK' on Galago
	
	//@@find a way to defer this via refcount with debouncing to avoid unnecessary power transitions and warm-up
	*PowerDownControl |= PowerDownControl_ADC;	//power on the ADC
	
	Pin* p = &p0;
	for(int i = 0; i < 26; i++)
		*p++ = Pin(kIOPinChart[i]);
	
	//enable interrupts we need for IO: I2C, the Timers, SPI0, UART and the ADC.
	*InterruptEnableSet1 = Interrupt1_I2C
		| Interrupt1_Timer0 | Interrupt1_Timer1 | Interrupt1_Timer2 | Interrupt1_Timer3
		| Interrupt1_SPI0 | Interrupt1_UART | Interrupt1_ADC;
}

extern "C"
void		IRQ_ADC(void)
{
	//save the result of the last conversion
	*IOCore.adcCurrentTask->output = *ADCData;
	//deselect the channel and reset the run mode (this has the effect of stopping the ADC
	//  if it isn't restarted for the next conversion.
	*ADCData &= ~(ADCControl_ChannelSelectBitmask | ADCControl_StartStopMask);
	
	//for performance, flexibility and jam-resistance, always start the next task before completing the current one.
	IOCore::ADCTask* last = IOCore.adcCurrentTask;
	IOCore.adcCurrentTask = (IOCore::ADCTask*)IOCore.adcCurrentTask->next;
	
	//start a new conversion
	if(IOCore.adcCurrentTask != 0)
		*ADCControl |= (ADCControl_StartNow | (1 << IOCore.adcCurrentTask->channel));
	else
	{
		//shut down the ADC - deselect the clock
		*ClockControl &= ~ClockControl_ADC;
		
		//*PowerDownControl |= PowerDownControl_ADC;	//@@probably overkill
	}
	
	//complete task
	system.completeTask(last->task);
	delete last;
}

int				IO::Pin::read(void)
{
	return(PIN_GPIO_DATA_PORT(PIN_IO_PORT(v))[1 << PIN_IO_PIN_NUM(v)]);
}
void			IO::Pin::write(int value)
{
	PIN_GPIO_DATA_PORT(PIN_IO_PORT(v))[1 << PIN_IO_PIN_NUM(v)] = (1 << PIN_IO_PIN_NUM(v));
}

Task			IO::Pin::readAnalog(unsigned int* result)
{
	*ClockControl |= ClockControl_ADC;	//enable the ADC clock if not already active
	
	int adcChannel = 0;
	switch(PIN_ID(v))
	{
	case PIN_A0:	adcChannel = 0;	break;
	case PIN_A1:	adcChannel = 1;	break;
	case PIN_A2:	adcChannel = 2;	break;
	case PIN_A3:	adcChannel = 3;	break;
	case PIN_A5:	adcChannel = 5;	break;
	case PIN_A7:	adcChannel = 7;	break;
	}
	
	Task task = system.createTask();
	IOCore::ADCTask* adcTask = new IOCore::ADCTask(adcChannel, result);
	adcTask->task = task;
	
	IOCore.queueItem((IOCore::TaskQueueItem**)&IOCore.adcCurrentTask, adcTask);
	
	return(task);
}

void			IO::Pin::setMode(Mode mode, Feature feature)
{
	unsigned int id = PIN_ID(v);
	unsigned int mask = (1 << id);
	
	REGISTER pinConfig = PIN_IOCONFIG_ADDRESS(id);
	
	switch(mode)
	{
	case IO::Pin::DigitalInput:
	case IO::Pin::DigitalOutput:
		{
			if(kPinSupportsGPIO & mask)
			{
				*pinConfig &= ~0x3;
				if(kPinFunc1IsGPIO & (1 << id))	*pinConfig |= 1;	//else mode is 0
				
				unsigned int bit = (1 << PIN_IO_PIN_NUM(v));
				REGISTER gpioDirPort = PIN_GPIO_DIR_PORT(PIN_IO_PORT(v));
				
				if(mode == IO::Pin::DigitalOutput)	*gpioDirPort |= bit;
				else								*gpioDirPort &= ~bit;
			}
		}
		break;
	case IO::Pin::AnalogInput:
		if(kPinSupportsADC & mask)
		{
			*pinConfig &= ~0x3;
			*pinConfig |= ((kPinFunc1IsADC & (1 << id))? 1 : 2);
		}
		break;
	case IO::Pin::Reset:
		if(id == PIN_P0)	//only gpio0.0 has reset ability
		{
			*pinConfig &= ~0x3;
			//it so happens mode 0 is reset on gpio0.0, so leave it
		}
		break;
	case IO::Pin::SPI:
		if(kPinSupportsSPI & mask)
		{
			*pinConfig &= ~0x3;
			*pinConfig |= ((id == PIN_SCK)? 2 : 1);
		}
		break;
	case IO::Pin::I2C:
		if(kPinSupportsI2C & mask)
		{
			*pinConfig &= ~0x3;
			*pinConfig |= 1;
		}
		break;
	case IO::Pin::UART:
		if(kPinSupportsUART & mask)
		{
			*pinConfig &= ~0x3;
			*pinConfig |= 1;
		}
		break;
	case IO::Pin::PWM:
		if(kPinSupportsPWM & mask)
		{
			*pinConfig &= ~0x3;
			if(id == PIN_P5)	*pinConfig |= 1;
			else				*pinConfig |= ((kPinFunc2IsPWM & (1 << id))? 2 : 3);
		}
		break;

	case IO::Pin::Manual:
	case IO::Pin::Default:
		break;
	}
}

////////////////////////////////////////////////////////////////
//

void			IO::SPI::start(int bitRate, Role role, Mode mode)
{
	*PeripheralnReset &= ~PeripheralnReset_SPI0;	//assert reset
	
	if(bitRate > 0)
	{
		*ClockControl |= ClockControl_SPI0;	//enable SPI0 clock
		*SPI0ClockPrescaler = 1;

		*SPI0ClockDivider = (system.getCoreFrequency() >> 1) / bitRate;

		*SPI0Control0 = SPI0Control0_8BitTransfer | SPI0Control0_FrameFormat_SPI | SPI0Control0_SPIMode0;
		*SPI0Control1 = SPI0Control1_Enable;

		*PeripheralnReset |= PeripheralnReset_SPI0;	//deassert reset
	}
	else
		*ClockControl &= ~ClockControl_SPI0;	//disable SPI0 clock
}


Task			IO::SPI::read(int length, byte* bytesReadBack, unsigned short writeChar)
{
	while(length-- > 0)
	{
		while(!(*SPI0Status & SPI0Status_ReceiveFIFONotEmpty));	//spinwait until the hardware can supply at least one datum
		
		*SPI0Data = (unsigned int)writeChar;	//append the character
		*bytesReadBack++ = (byte)*SPI0Data;
	}
}

Task			IO::SPI::read(int length, unsigned short* bytesReadBack, unsigned short writeChar)
{
	while(length-- > 0)
	{
		while(!(*SPI0Status & SPI0Status_ReceiveFIFONotEmpty));	//spinwait until the hardware can supply at least one datum
		
		*SPI0Data = (unsigned int)writeChar;	//append the character
		*bytesReadBack++ = (unsigned short)*SPI0Data;
	}
}


Task			IO::SPI::write(unsigned short h, int length)
{
	while(length-- > 0)
	{
		while(!(*SPI0Status & SPI0Status_TransmitFIFONotFull));	//spinwait until the hardware can fit at least one datum
		*SPI0Data = (unsigned int)h;	//append the same character
	}
}

Task			IO::SPI::write(byte const* s, int length, byte* bytesReadBack)
{
	while(length-- > 0)
	{
		while(!(*SPI0Status & SPI0Status_TransmitFIFONotFull));	//spinwait until the hardware can fit at least one datum
		*SPI0Data = (unsigned int)*s++;	//append the next character
		if(bytesReadBack != 0)
			*bytesReadBack++ = (byte)*SPI0Data;
	}
}
Task			IO::SPI::write(unsigned short const* s, int length, byte* bytesReadBack)
{
	while(length-- > 0)
	{
		while(!(*SPI0Status & SPI0Status_TransmitFIFONotFull));	//spinwait until the hardware can fit at least one datum
		*SPI0Data = (unsigned int)*s++;	//append the next character
		if(bytesReadBack != 0)
			*bytesReadBack++ = (byte)*SPI0Data;
	}
}

////////////////////////////////////////////////////////////////
//

void		IO::UART::start(int baudRate, Mode mode)
{
	if(baudRate > 0)
	{
		int q = system.getCoreFrequency() / (16 * baudRate);
		int n = 0;
		int d = 1;
		
		IO::UART::startWithExplicitRatio(q, n, d, mode);
	}
	else	//else shut down the UART
	{
		*InterruptEnableClear1 |= Interrupt1_UART;	//disable UART interrupt
		
		*UARTFIFOControl = (UARTFIFOControl_RxReset | UARTFIFOControl_TxReset);	//disable and reset
		
		*ClockControl &= ~ClockControl_UART;
	}
}
void		IO::UART::startWithExplicitRatio(int divider, int fracN, int fracD, Mode mode)
{
	*ClockControl |= ClockControl_UART;
	*UARTClockDivider = 1;
	
	*UARTLineControl = (mode & 0xFF) | UARTLineControl_DivisorLatch;	//apply mode and enter DLAB state
	
	*UARTDivisorLow = divider & 0xFF;		//write divisor bytes
	*UARTDivisorHigh = (divider >> 8) & 0xFF;
	
	*UARTLineControl &= ~UARTLineControl_DivisorLatch;	//exit DLAB state
	*UARTModemControl = (mode >> 8) & 0xC7;
	
	*UARTFIFOControl |= (UARTFIFOControl_Enable | UARTFIFOControl_RxReset | UARTFIFOControl_TxReset | UARTFIFOControl_RxInterrupt1Char);
	
	(void)*UARTLineStatus;	//clear status
	
	//interrupt on received data, tx buffer empty and line status
	*UARTInterrupts = (UARTInterrupts_ReceivedData | UARTInterrupts_TxBufferEmpty | UARTInterrupts_RxLineStatus);
	*InterruptEnableSet1 |= Interrupt1_UART; //set up UART interrupt	//@@done in IO:IO()
}

extern "C"
void	IRQ_UART(void)
{
	//receive any available bytes
	while(*UARTLineStatus & UARTLineStatus_ReceiverDataReady)
	{
		if(!IOCore.uartReceiveBuffer->write(*UARTData))
			break;
	}
	
	//do we have bytes to send?
	while(IOCore.uartCurrentWriteTask != 0)
	{
		IOCore::WriteTask* writeTask = IOCore.uartCurrentWriteTask;
		//push chars only while there's room.
		while(		(writeTask->idx < writeTask->len)	//while there are chars to send
					&& (*UARTLineStatus & UARTLineStatus_TxHoldingRegisterEmpty)	//and the FIFO isn't full
				)
			*UARTData = writeTask->data[writeTask->idx++];	//push chars into the FIFO
		
		if(writeTask->idx == writeTask->len)	//if finished
		{
			IOCore.uartCurrentWriteTask = (IOCore::WriteTask*)writeTask->next;
			system.completeTask(writeTask->task);
			delete writeTask;
		}
		else
		{
			//would set interrupt on non-full/empty tx buffer, but the LPC1xx's 16C550 implementation doesn't have one
			//  so we have to resort to polling :-(
			//  a period of 50us-60us supports megabaud rates
			
			//@@todo: poll
			
			break;	//don't move to the next packet
		}
	}
}

int		IO::UART::read(byte* s, int length)
{
	//read bytes from the RX buffer.  Synchronous and nonblocking
	
	if(IOCore.uartReceiveBuffer == 0)
		return(0);
	
	return(IOCore.uartReceiveBuffer->read(s, length));
}


Task		IO::UART::write(byte const* s, int length)
{
	Task task = system.createTask();
	IOCore::WriteTask* writeTask = new(length) IOCore::WriteTask(s, length);
	writeTask->task = task;
	
	IOCore.queueItem((IOCore::TaskQueueItem**)&IOCore.uartCurrentWriteTask, writeTask);
	
	return(task);
}

////////////////////////////////////////////////////////////////
// I2C

void			IRQ_I2C(void)
{
	int status = *I2CStatus;
	IOCore::WriteTask* currentTask = IOCore.i2cCurrentTask;
	switch(status)
	{
	case 0x08:	//start bit sent
	case 0x10:	//repeated start
		*I2CData = currentTask->data[0];
		*I2CControlClear = I2CControlSet_StartCondition;
		break;
		
	case 0x18:	//write address ACKed, ready to write
		*I2CData = currentTask->data[0];
		break;
		
	case 0x20:	//write address NACKed, stop
		*I2CControlSet = I2CControlSet_StopCondition;
		
		//@@abort packet
		break;
		
	case 0x48:	//read address NACKed, stop
		*I2CControlSet = I2CControlSet_StopCondition;
		
		//@@abort packet
		break;
		
	case 0x40:	//read address ACKed, ready to read
		if(currentTask->len == 1)	*I2CControlClear = I2CControlSet_Ack;
		
		break;
	
	case 0x28:	//byte sent, ACK received
		if(currentTask->idx < currentTask->len)
			*I2CData = currentTask->data[currentTask->idx++];
		else
		{
			if(		(currentTask->next != 0)
					&& (((IOCore::WriteTask*)(currentTask->next))->data[0] == currentTask->data[0])	//same slave?
				)
				*I2CControlSet = I2CControlSet_StartCondition;
			else
				*I2CControlSet = I2CControlSet_StopCondition;
		}
		break;
		
	case 0x30:	//byte sent, NACK received
		*I2CControlClear = I2CControlSet_StopCondition;
		//@@abort
		break;
		
	case 0x50:	//byte received, ACK sent
		currentTask->data[currentTask->idx++] = *I2CData;
		
		if(currentTask->idx < currentTask->len)	*I2CControlSet = I2CControlSet_Ack;
		else										*I2CControlClear = I2CControlSet_Ack;
		
		break;
		
	case 0x58:	//byte received, NACK sent
		*I2CControlSet = I2CControlSet_StopCondition;
		break;
	
	case 0x38:	//arbitration loss, abort
		//boo :-(
		break;
	}
	
	*I2CControlClear = I2CControlSet_Interrupt;
}

void	IO::I2C::start(int bitRate, IO::I2C::Role role)
{
	*I2CControlClear = 0x6C;	//turn off (clear all bits)
	*PeripheralnReset &= ~PeripheralnReset_I2C;	//assert reset
	
	if(bitRate > 0)
	{
		*ClockControl |= ClockControl_I2C;
		*PeripheralnReset |= PeripheralnReset_I2C;	//deassert reset
		
		unsigned int bitHalfPeriod = (system.getCoreFrequency() / bitRate) >> 1;
		//@@depending on the time-constant of the bus (1 / (pull-up resistance * capacitance)),
		//  the low-time should be smaller and the high-time should be higher
		*I2CClockHighTime = bitHalfPeriod;
		*I2CClockLowTime = bitHalfPeriod;
		
		*I2CControlSet = I2CControlSet_EnableI2C;
		*InterruptEnableSet1 = Interrupt1_I2C;
	}
	else
	{
		//shut down I2C clock
		*ClockControl &= ~ClockControl_I2C;
		*InterruptEnableClear1 = Interrupt1_I2C;
	}
}

Task	IO::I2C::write(byte address, byte const* s, int length, IO::I2C::RepeatedStartSetting repeatedStart)
{
	Task task = system.createTask();
	IOCore::WriteTask* writeTask = new(length) IOCore::WriteTask(s, length);
	writeTask->task = task;
	
	IOCore.queueItem((IOCore::TaskQueueItem**)&IOCore.i2cCurrentTask, writeTask);
	return(task);
}
