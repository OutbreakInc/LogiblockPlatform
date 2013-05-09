#ifndef __GALAGO_H__
#define __GALAGO_H__

#include <stddef.h>

typedef unsigned char	byte;

namespace Galago {

class Task;

struct InternalTaskCallback;
struct InternalTask
{
	friend class Task;
	
	unsigned short			_flags;
	unsigned short			_rc;
	InternalTaskCallback*	_c;
	
	void					destroy(void);
};

class Task
{
	friend class System;
	public:		inline 					Task(void): _t(0)	{}
	public:		inline 					Task(Task const& t): _t(t._t)	{refer(_t);}
	public:		inline 					Task(InternalTask* t): _t(t)	{refer(_t);}
	public:		inline 					~Task(void)				{release(_t); _t = 0;}
	
	public:		Task&					operator =(Task const& t);
	
	public:		inline bool operator	==(Task const& t) const	{return(t._t == _t);}
	public:		inline bool operator	!=(Task const& t) const	{return(t._t != _t);}
	
	public:		Task operator			+(Task const& r) const;
	
	
	private:	inline static void		refer(InternalTask* t)	{if(t)	t->_rc++;}
	private:	static void				release(InternalTask* t);
	
	private:	InternalTask*	_t;
};

struct CircularBuffer
{
public:
			CircularBuffer(int size);
			~CircularBuffer(void);

	bool	write(byte b);
	int		write(byte const* b, int length);
	bool	read(byte* b);
	int		read(byte* b, int length);
	
	int		bytesUsed(void) const;
	int		bytesFree(void) const;
	
private:
	byte*	_start;
	byte*	_end;
	byte*	_head;
	byte*	_tail;
};

class Buffer
{
public:
	inline					Buffer(void) {};
	inline					Buffer(Buffer const& b);
	inline Buffer&			operator =(Buffer const& b);
	
	inline size_t			length() const;
	inline byte*			bytes();
	inline byte const*		bytes() const;
	
	static inline Buffer	New(char const* cStr);
	static inline Buffer	New(size_t length);
	static inline Buffer	New(void* b, size_t length);
	
	Buffer					operator +(Buffer const& b) const;
	Buffer&					operator +=(Buffer const& b);
	
	bool					operator ==(Buffer const& b) const;
	bool					operator ==(char const* cStr) const;
	
	unsigned int			ParseUint(int base = 10);
	signed int				ParseInt(int base = 10);
	
	bool					StartsWith(byte const* str, size_t length) const;
	bool					StartsWith(char const* cStr) const;
	bool					Equals(byte const* str, size_t length) const;
	
	byte					operator[](size_t offset) const;
	
	Buffer					Slice(size_t start, size_t end);
	size_t					IndexOf(byte b, size_t offset = 0);
	size_t					IndexOf(Buffer b, size_t offset = 0);
};

class IO
{
public:

	class Pin
	{
		friend class IO;

	public:
		typedef enum
		{
			DigitalInput,
			DigitalOutput,
			AnalogInput,
			
			Reset,
			SPI,
			I2C,
			UART,
			PWM,
			USB,
			
			ClockOutput,
			Wakeup,
			
			Manual = 0xFE,
			Default,
		} Mode;
		
		//not all parts feature these pin modes
		typedef enum
		{
			Normal,
			PullUp,
			PullDown,
			
			Sensitive,	//Sensistive mode implies hysteresis/Schmitt-triggers are disabled for the pin

			//OpenDrain means a logic high results in a high-impedance (un-driven) pin
			//  and a logic low drives the pin low
			OpenDrain,
		} Feature;
		
		inline			Pin(Pin const& p): v(p.v)			{}
		inline	Pin&	operator =(Pin const& p)			{v = p.v; return(*this);}

		inline	Pin&	operator =(bool value)	{write(value? 1 : 0); return(*this);}
		inline	Pin&	operator =(int value)	{write(value); return(*this);}
		inline			operator bool(void)		{return((bool)read());}

		int				read(void);
		Task			readAnalog(unsigned int* result);
		void			write(int value);

		inline	void	setOutput(void)		{setMode(DigitalOutput);}
		inline	void	setInput(void)		{setMode(DigitalInput);}
		inline	void	setAnalog(void)		{setMode(AnalogInput);}
		inline	void	setPWM(void)		{setMode(PWM);}
		
		void			setMode(Mode mode, Feature feature = Normal);

	private:
		inline			Pin(unsigned int value): v(value)	{setMode(Default);}
		inline			Pin(void)							{}
		
		unsigned int	v;
	};

	class SPI
	{
	public:
		typedef enum
		{
			Master,
			Slave,
		} Role;
		
		typedef enum
		{
			Mode0,	//SCK idles low, data changed on SCK's falling edge, read on rising edge.
			Mode1,	//SCK idles low, data changed on SCK's rising edge, read on falling edge.
			Mode2,	//SCK idles high, data changed on SCK's falling edge, read on rising edge.
			Mode3,	//SCK idles high, data changed on SCK's rising edge, read on falling edge.
		} Mode;

		void			start(int bitRate = 2000000UL, Role role = Master, Mode mode = Mode0);
		inline void		stop(void)	{start(0);}
		
		bool			bytesAvailable(void) const;
		
		Task			read(int length, byte* bytesReadBack, unsigned short writeChar = 0);
		Task			read(int length, unsigned short* bytesReadBack, unsigned short writeChar = 0);
		
		inline Task		readAndWrite(char const* s, int length, byte* bytesReadBack) {return(write((byte const*)s, length, bytesReadBack));}
		inline Task		readAndWrite(byte const* s, int length, byte* bytesReadBack) {return(write(s, length, bytesReadBack));}
		inline Task		readAndWrite(unsigned short const* s, int length, byte* bytesReadBack) {return(write(s, length, bytesReadBack));}
		
		inline Task		write(char c, int length = 1)		{return(write((unsigned short)c, length));}
		inline Task		write(byte b, int length = 1)		{return(write((unsigned short)b, length));}
		inline Task		write(short h, int length = 1)		{return(write((unsigned short)h, length));}
		Task			write(unsigned short h, int length = 1);
		
		inline Task		write(char const* s, int length, byte* bytesReadBack = 0)	{return(write((byte const*)s, length, bytesReadBack));}
		Task			write(byte const* s, int length, byte* bytesReadBack = 0);
		Task			write(unsigned short const* s, int length, byte* bytesReadBack = 0);
	};

	class I2C
	{
	public:
		typedef enum
		{
			Master,
			Slave,
		} Role;
		
		typedef enum
		{
			No,
			RepeatedStart,
		} RepeatedStartSetting;
		
		void			start(int bitRate = 100000UL, Role role = Master);
		inline void		stop(void)	{start(0);}
		
		Task			write(byte address, byte const* s, int length, RepeatedStartSetting repeatedStart = No);
		inline Task		read(byte address, byte* s, int length, RepeatedStartSetting repeatedStart = No)
							{return(write(address | 1, s, length, repeatedStart));}
		
		void			end(void);
	};

	class UART
	{
	public:
		enum
		{
			CharsAre5Bit			=	(0x00),
			CharsAre6Bit			=	(0x01),
			CharsAre7Bit			=	(0x02),
			CharsAre8Bit			=	(0x03),
			
			OneStopBit				=	(0x00),
			TwoStopBits				=	(0x04),
			
			NoParity				=	(0x00),
			UseOddParity			=	(0x08 | (0x00 << 4)),
			UseEvenParity			=	(0x08 | (0x01 << 4)),
			UseConstant1Parity		=	(0x08 | (0x02 << 4)),
			UseConstant0Parity		=	(0x08 | (0x03 << 4)),
			
			Default  				=	(CharsAre8Bit | NoParity | OneStopBit)
		};
		typedef int		Mode;
		
		typedef enum
		{
			BytesReceived,
			ErrorReceived,
		} Event;
		
		typedef void	(*UARTCallback)(void* receiver, UART& uart, Event event);
		
		void			start(		int baudRate = 9600,
									Mode mode = Default,
									UART::UARTCallback callback = 0,
									void* callbackContext = 0
								);
		void			startWithExplicitRatio(int divider, int fracN, int fracD, Mode mode);
		inline void		stop(void)	{start(0);}
		
		int				bytesAvailable(void) const;

		//these functions are synchronous and nonblocking, returning only what's in the buffer (and not waiting for data)
		inline int		read(char* s, int length)	{read((byte*)s, length);}
		int				read(byte* s, int length);

		typedef enum
		{
			Character,
			UnsignedByte,
			SignedByte,
			UnsignedInteger16,
			SignedInteger16,
			UnsignedInteger32,
			SignedInteger32
		} Format;
		
		Task			write(unsigned int w, Format format = UnsignedInteger32);
		inline Task		write(byte b, Format format = UnsignedByte)					{return(write((unsigned int)b, format));}
		inline Task		write(char c, Format format = Character)					{return(write((unsigned int)c, format));}
		inline Task		write(unsigned short h, Format format = UnsignedInteger16)	{return(write((unsigned int)h, format));}
		inline Task		write(short h, Format format = SignedInteger16)				{return(write((unsigned int)h, format));}
		inline Task		write(int w, Format format = SignedInteger32)				{return(write((unsigned int)w, format));}

		inline Task		write(char const* s, int length = -1)	{return(write((byte const*)s, length));}
		Task			write(byte const* s, int length = -1);
	};

	Pin				p0;
	Pin				p1;
	Pin				p2;
	Pin				p3;
	Pin				p4;
	Pin				p5;
	Pin				p6;
	
	Pin				dminus;
	Pin				dplus;
	
	Pin				rts;
	Pin				cts;
	Pin				txd;
	Pin				rxd;
	
	Pin				sda;
	Pin				scl;
	
	Pin				sck;
	Pin				sel;
	Pin				miso;
	Pin				mosi;
	
	Pin				a0;
	Pin				a1;
	Pin				a2;
	Pin				a3;
	Pin				a5;
	Pin				a7;
	
	Pin				led;
	
	SPI				spi;
	
	I2C				i2c;
	
	UART			serial;

					IO(void);
private:
	unsigned int	v;
};

class System
{
public:
	static void*	alloc(size_t size);
	static void		free(void* allocation);
	
	unsigned int	getMainClockFrequency(void) const;
	unsigned int	getCoreFrequency(void) const;
	void			setCoreFrequency(unsigned int desiredFrequency);
	unsigned int	getClockOutputFrequency(void) const;
	void			setClockOutputFrequency(unsigned int desiredFrequency);
	
	void			sleep(void) const;
	
	Task			createTask(void);
	
	bool			completeTask(Task t, bool success = true);
	
	//These methods use the minimum power by sleeping when possible:

	//asynchronously respond when a task is complete.
	bool			when(Task t, void (*completion)(void* context, Task, bool success), void* completionContext = 0);
	
	//synchronously wait for a task to complete. Completion callbacks for other tasks will be called from within this
	//  method, making it not strictly blocking.
	typedef enum
	{
		InvokeCallbacks,
		DoNotInvokeCallbacks,
	} InvokeCallbacksOption;
	bool			wait(Task t, InvokeCallbacksOption invokeCallbacks = InvokeCallbacks);
	
					System(void);
	
	Task			delay(int milliseconds);
};

extern IO		io;
extern System	system;

}	//ns Galago

inline void*		operator new(size_t size)	{return(Galago::System::alloc(size));}

inline void*		operator new[](size_t size)	{return(Galago::System::alloc(size));}

inline void*		operator new[](size_t size, unsigned int extra)	{return(Galago::System::alloc(size + extra));}

inline void*		operator new(size_t size, unsigned int extra)	{return(Galago::System::alloc(size + extra));}

inline void			operator delete(void* p)
{
	if(((unsigned int)(size_t)p) & 0x3)	return;	//@@throw
	Galago::System::free((unsigned int*)p);
}

inline void			operator delete[](void* p)
{
	if(((unsigned int)(size_t)p) & 0x3)	return;	//@@throw
	Galago::System::free((unsigned int*)p);
}


#endif //defined __GALAGO_H__